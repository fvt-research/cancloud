// vite.config.mjs aliases aws-sdk to its prebuilt browser bundle (the source
// entry's circular CJS requires break under Rollup's prod interop). The bundle
// exports nothing importable - it sets window.AWS as a side effect.
import "aws-sdk";
const AWS = window.AWS;

class AwsSdk {
  constructor(accessKeyId, secretAccessKey, endpoint) {
    this.aws3 = new AWS.S3({
      accessKeyId,
      secretAccessKey,
      endpoint,
      s3ForcePathStyle: true
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
