const express = require("express");
const path = require("path");
const fs = require("fs");
const https = require("https");
const AWS = require("aws-sdk");

const app = express();
const PORT = process.env.PORT || 3000;
const SITE_DIR = path.join(__dirname, "site");

app.use(express.json({ limit: "1mb" }));

const isTruthy = (value) => /^(1|true|yes)$/i.test(String(value || ""));

const resolveCaBundlePath = () => {
    const explicitPath =
        process.env.S3_PROXY_CA_BUNDLE ||
        process.env.AWS_CA_BUNDLE ||
        process.env.NODE_EXTRA_CA_CERTS;

    if (explicitPath) {
        return explicitPath;
    }

    const defaultPaths = [
        "/etc/ssl/certs/ca-certificates.crt",
        "/etc/ssl/cert.pem"
    ];

    return defaultPaths.find((candidate) => fs.existsSync(candidate)) || "";
};

const buildHttpsAgent = () => {
    const insecureTls = isTruthy(process.env.S3_PROXY_INSECURE_TLS);
    const caBundlePath = resolveCaBundlePath();

    const agentOptions = {
        rejectUnauthorized: !insecureTls
    };

    if (caBundlePath) {
        try {
            agentOptions.ca = fs.readFileSync(caBundlePath);
        } catch (err) {
            console.warn(`Could not load CA bundle from ${caBundlePath}: ${err.message}`);
        }
    }

    return {
        agent: new https.Agent(agentOptions),
        caBundlePath,
        insecureTls
    };
};

app.post("/api/list-buckets", async (req, res) => {
    const { accessKey, secretKey, endPoint, region } = req.body || {};

    if (!accessKey || !secretKey || !endPoint) {
        return res.status(400).json({
            error: "accessKey, secretKey and endPoint are required"
        });
    }

    const awsServiceEndpointRegex = /^https?:\/\/s3\.([a-z0-9-]+)\.amazonaws\.com\/?$/i;
    const endpointMatch = endPoint.match(awsServiceEndpointRegex);
    const resolvedRegion = region || (endpointMatch ? endpointMatch[1] : undefined);

    const baseConfig = {
        accessKeyId: accessKey,
        secretAccessKey: secretKey,
        signatureVersion: "v4",
        region: resolvedRegion
    };

    let tlsConfigMeta = {
        caBundlePath: "",
        insecureTls: false
    };

    if (/^https:/i.test(endPoint)) {
        const tlsConfig = buildHttpsAgent();
        tlsConfigMeta = {
            caBundlePath: tlsConfig.caBundlePath,
            insecureTls: tlsConfig.insecureTls
        };
        baseConfig.httpOptions = {
            agent: tlsConfig.agent
        };
    }

    const s3Config = endpointMatch
        ? baseConfig
        : {
            ...baseConfig,
            endpoint: endPoint,
            s3ForcePathStyle: true
        };

    try {
        const s3 = new AWS.S3(s3Config);
        const data = await s3.listBuckets().promise();
        const buckets = (data.Buckets || []).map((bucket) => bucket.Name);
        return res.json({ buckets });
    } catch (err) {
        const errorMessage = err && err.message ? err.message : "Unknown error";
        const certIssue = /unable to get local issuer certificate|self signed certificate|certificate/i.test(
            errorMessage
        );

        return res.status(500).json({
            error: errorMessage,
            code: err && err.code ? err.code : "UNKNOWN",
            endpoint: endPoint,
            region: resolvedRegion || "",
            caBundlePath: tlsConfigMeta.caBundlePath,
            insecureTls: tlsConfigMeta.insecureTls,
            hint: certIssue
                ? "TLS certificate trust issue in proxy container. Configure S3_PROXY_CA_BUNDLE/AWS_CA_BUNDLE/NODE_EXTRA_CA_CERTS, or set S3_PROXY_INSECURE_TLS=true for testing only."
                : ""
        });
    }
});

app.use(express.static(SITE_DIR));
app.get("*", (_req, res) => {
    res.sendFile(path.join(SITE_DIR, "index.html"));
});

app.listen(PORT, () => {
    console.log(`CANcloud server listening on port ${PORT}`);
});
