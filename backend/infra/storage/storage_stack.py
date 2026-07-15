"""Storage stack: DynamoDB tables and S3 buckets.

Defines the Job/Clip/Refinement/ConfirmedSelection/Connection DynamoDB
tables and the Raw_Bucket + frontend static-asset S3 buckets described in
design.md's Data Models section. Both buckets block all public access;
media is only ever reachable via presigned URLs (Req 3.6) or, for the
frontend bucket, via CloudFront (Req 17.1, 17.2).
"""
from aws_cdk import (
    Stack,
    RemovalPolicy,
    aws_dynamodb as dynamodb,
    aws_s3 as s3,
)
from constructs import Construct


class StorageStack(Stack):
    """Holds DynamoDB tables and S3 buckets for the webapp-skeleton backend."""

    def __init__(self, scope: Construct, construct_id: str, **kwargs) -> None:
        super().__init__(scope, construct_id, **kwargs)

        # --- Task 2.1: DynamoDB tables -------------------------------------

        self.job_table = dynamodb.Table(
            self,
            "JobTable",
            partition_key=dynamodb.Attribute(
                name="jobId", type=dynamodb.AttributeType.STRING
            ),
            billing_mode=dynamodb.BillingMode.PAY_PER_REQUEST,
            removal_policy=RemovalPolicy.DESTROY,
        )

        self.clip_table = dynamodb.Table(
            self,
            "ClipTable",
            partition_key=dynamodb.Attribute(
                name="jobId", type=dynamodb.AttributeType.STRING
            ),
            sort_key=dynamodb.Attribute(
                name="clipId", type=dynamodb.AttributeType.STRING
            ),
            billing_mode=dynamodb.BillingMode.PAY_PER_REQUEST,
            removal_policy=RemovalPolicy.DESTROY,
        )

        self.refinement_table = dynamodb.Table(
            self,
            "RefinementTable",
            partition_key=dynamodb.Attribute(
                name="jobId", type=dynamodb.AttributeType.STRING
            ),
            sort_key=dynamodb.Attribute(
                name="refinementId", type=dynamodb.AttributeType.STRING
            ),
            billing_mode=dynamodb.BillingMode.PAY_PER_REQUEST,
            removal_policy=RemovalPolicy.DESTROY,
        )

        self.confirmed_selection_table = dynamodb.Table(
            self,
            "ConfirmedSelectionTable",
            partition_key=dynamodb.Attribute(
                name="jobId", type=dynamodb.AttributeType.STRING
            ),
            sort_key=dynamodb.Attribute(
                name="handoffId", type=dynamodb.AttributeType.STRING
            ),
            billing_mode=dynamodb.BillingMode.PAY_PER_REQUEST,
            removal_policy=RemovalPolicy.DESTROY,
        )
        # GET /handoff/{handoffId} (Task 8.6) looks up a ConfirmedSelection
        # by handoffId alone, without the owning jobId in the URL.
        self.confirmed_selection_table.add_global_secondary_index(
            index_name="byHandoffId",
            partition_key=dynamodb.Attribute(
                name="handoffId", type=dynamodb.AttributeType.STRING
            ),
        )

        # Confirmed-upload registry backing Req 4.7 (Job_API must reject
        # sourceKeys[] that were never confirmed as uploaded). Keyed by
        # (userId, key) so Upload_API's confirm handler and Job_API's
        # create-job handler agree on what "confirmed" means per caller.
        self.confirmed_uploads_table = dynamodb.Table(
            self,
            "ConfirmedUploadsTable",
            partition_key=dynamodb.Attribute(
                name="userId", type=dynamodb.AttributeType.STRING
            ),
            sort_key=dynamodb.Attribute(
                name="key", type=dynamodb.AttributeType.STRING
            ),
            billing_mode=dynamodb.BillingMode.PAY_PER_REQUEST,
            removal_policy=RemovalPolicy.DESTROY,
        )

        # Progress_API connection registry: not in design.md's Data Models
        # section (which only lists Job/Clip/Refinement/ConfirmedSelection),
        # but required to implement $connect/subscribe/$disconnect/push
        # (Req 3.4, 3.5, 5.3). PK connectionId; GSI on jobId supports
        # fan-out of progress events to every connection subscribed to a job.
        self.connection_table = dynamodb.Table(
            self,
            "ConnectionTable",
            partition_key=dynamodb.Attribute(
                name="connectionId", type=dynamodb.AttributeType.STRING
            ),
            billing_mode=dynamodb.BillingMode.PAY_PER_REQUEST,
            removal_policy=RemovalPolicy.DESTROY,
        )
        self.connection_table.add_global_secondary_index(
            index_name="byJobId",
            partition_key=dynamodb.Attribute(
                name="jobId", type=dynamodb.AttributeType.STRING
            ),
        )

        # --- Task 2.2: S3 buckets -------------------------------------------

        # Raw_Bucket: uploaded VOD sources under raw/, thumbnails/video
        # previews written by stub stages. Presigned-URL only (Req 3.6).
        self.raw_bucket = s3.Bucket(
            self,
            "RawBucket",
            block_public_access=s3.BlockPublicAccess.BLOCK_ALL,
            encryption=s3.BucketEncryption.S3_MANAGED,
            enforce_ssl=True,
            cors=[
                s3.CorsRule(
                    allowed_methods=[s3.HttpMethods.PUT, s3.HttpMethods.GET],
                    allowed_origins=["*"],
                    allowed_headers=["*"],
                )
            ],
            removal_policy=RemovalPolicy.DESTROY,
            auto_delete_objects=True,
        )

        # Note: the frontend static-asset bucket is NOT defined here. A
        # CloudFront distribution's Origin-Access-Control bucket policy
        # references the distribution's ARN, and the distribution's origin
        # config references the bucket -- putting the bucket and
        # distribution in different stacks creates a genuine CloudFormation
        # cross-stack circular reference. So the frontend bucket is defined
        # in HostingStack instead, alongside the distribution that reads it
        # (Task 14.1, 14.2; Req 17.1, 17.2).
