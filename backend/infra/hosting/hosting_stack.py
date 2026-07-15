"""Frontend hosting stack: frontend static-asset S3 bucket + the CloudFront
distribution in front of it.

The bucket lives in this stack (rather than StorageStack) because an
Origin-Access-Control bucket policy references the distribution's ARN while
the distribution's origin config references the bucket -- splitting them
across stacks creates a CloudFormation circular cross-stack reference.

Task 14.1: the bucket blocks all public access, and an Origin Access
Control ensures only this CloudFront distribution can read it, so direct
end-user requests to the S3 endpoint are denied (Req 17.1, 17.2).

Task 14.2: HTTPS-only viewer protocol policy (Req 17.3), and custom error
responses mapping 403/404 to index.html with a 200 status so client-side
routing can resolve any SPA path (Req 17.4).
"""
from aws_cdk import (
    RemovalPolicy,
    Stack,
    aws_cloudfront as cloudfront,
    aws_cloudfront_origins as origins,
    aws_s3 as s3,
)
from constructs import Construct


class HostingStack(Stack):
    """Holds the frontend static-asset bucket and the CloudFront
    distribution serving the frontend SPA bundle."""

    def __init__(
        self,
        scope: Construct,
        construct_id: str,
        **kwargs,
    ) -> None:
        super().__init__(scope, construct_id, **kwargs)

        # Task 14.1: frontend static-asset bucket -- never readable
        # directly (Req 17.1); only CloudFront (via OAC below) can read it.
        self.frontend_bucket = s3.Bucket(
            self,
            "FrontendBucket",
            block_public_access=s3.BlockPublicAccess.BLOCK_ALL,
            encryption=s3.BucketEncryption.S3_MANAGED,
            enforce_ssl=True,
            removal_policy=RemovalPolicy.DESTROY,
            auto_delete_objects=True,
        )

        origin = origins.S3BucketOrigin.with_origin_access_control(
            self.frontend_bucket
        )

        # Task 14.2: HTTPS-only + SPA fallback.
        self.distribution = cloudfront.Distribution(
            self,
            "FrontendDistribution",
            default_root_object="index.html",
            default_behavior=cloudfront.BehaviorOptions(
                origin=origin,
                viewer_protocol_policy=cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
            ),
            error_responses=[
                cloudfront.ErrorResponse(
                    http_status=403,
                    response_http_status=200,
                    response_page_path="/index.html",
                ),
                cloudfront.ErrorResponse(
                    http_status=404,
                    response_http_status=200,
                    response_page_path="/index.html",
                ),
            ],
        )
