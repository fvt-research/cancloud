import AWS from "aws-sdk";

class AwsSdk {
  constructor(accessKeyId, secretAccessKey, endpoint, region) {
    const awsServiceEndpointRegex = /^https?:\/\/s3\.([a-z0-9-]+)\.amazonaws\.com\/?$/i;
    const endpointMatch = endpoint ? endpoint.match(awsServiceEndpointRegex) : null;
    const resolvedRegion = region || (endpointMatch ? endpointMatch[1] : undefined);
    const baseConfig = {
      accessKeyId,
      secretAccessKey,
      signatureVersion: "v4",
      region: resolvedRegion
    };

    // For AWS S3 service endpoints, let the SDK build the native regional endpoint.
    if (endpointMatch) {
      this.aws3 = new AWS.S3(baseConfig);
      return;
    }

    this.aws3 = new AWS.S3({
      ...baseConfig,
      endpoint,
      s3ForcePathStyle: true
    });
  }

  listBuckets() {
    return new Promise((resolve, reject) => {
      this.aws3.listBuckets((err, data) => {
        if (err) {
          reject(err);
        } else {
          resolve(data.Buckets || []);
        }
      });
    });
  }

  selectObjectContent(params) {
    return new Promise((resolve, reject) => {
      this.aws3.selectObjectContent(params, (err, data) => {
        if (err) {
          reject(err);
        } else {
          let result = "";
          const events = data.Payload;
          for (const event of events) {
            if (event.Records) {
              result = result.concat(event.Records.Payload.toString());
            } else if (event.Stats) {
            } else if (event.End) {
              resolve(result);
            }
          }
        }
      });
    });
  }
}

export default AwsSdk;
