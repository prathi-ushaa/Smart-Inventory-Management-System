// Low-stock alerts. Always logs; also emails through Amazon SNS when SNS_TOPIC_ARN is set.
const ARN = process.env.SNS_TOPIC_ARN;
let sns, sdk;

if (ARN) {
  sdk = require('@aws-sdk/client-sns');
  sns = new sdk.SNSClient({ region: process.env.AWS_REGION }); // credentials come from the EC2 IAM role
}

exports.lowStock = async (p) => {
  const text = `${p.name} (${p.sku}) is down to ${p.quantity}. Reorder level is ${p.reorderLevel}.`;
  console.log('LOW STOCK:', text);
  if (!ARN) return;
  await sns.send(new sdk.PublishCommand({ TopicArn: ARN, Subject: `Low stock: ${p.name}`, Message: text }));
};
