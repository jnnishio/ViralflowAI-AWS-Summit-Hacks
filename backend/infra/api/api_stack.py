"""API/compute stack: Cognito, API Gateway (REST + WebSocket), Lambdas, and
the Step Functions Pipeline_Orchestrator.

Wires:
- Task 3.1-3.3: Cognito User Pool/App Client, REST API with a Cognito
  authorizer on every route, WebSocket API with a Lambda authorizer on
  $connect (WebSocket APIs have no native Cognito authorizer type).
- Task 5-10: Upload_API, Job_API, Highlights_API Lambda handlers behind the
  REST API; Progress_API $connect/$disconnect/subscribe handlers behind the
  WebSocket API.
- Task 11: the 7 Analysis_Stage_Stub Lambdas + the Pipeline_Orchestrator
  state machine (Step Functions), matching architecture.md's stage order.
- Task 13: route wiring + IAM permissions.
"""
from __future__ import annotations

import os

from aws_cdk import (
    Duration,
    RemovalPolicy,
    Stack,
    aws_apigateway as apigateway,
    aws_apigatewayv2 as apigwv2,
    aws_apigatewayv2_authorizers as apigwv2_authorizers,
    aws_apigatewayv2_integrations as apigwv2_integrations,
    aws_cognito as cognito,
    aws_dynamodb as dynamodb,
    aws_iam as iam,
    aws_lambda as lambda_,
    aws_s3 as s3,
    aws_stepfunctions as sfn,
    aws_stepfunctions_tasks as sfn_tasks,
    aws_ecs as ecs,
    aws_ec2 as ec2,
)
from constructs import Construct

BACKEND_ROOT = os.path.join(os.path.dirname(__file__), "..", "..")

# Stage order matches architecture.md's fusion pipeline exactly (Req 6.1).
NO_OP_STAGES = [
    "normalize/proxy",
    "transcript",
    "visual analysis",
    "audio analysis",
    "chat analysis",
]


class ApiStack(Stack):
    """Holds Cognito, API Gateway, Lambda handlers, and the Step Functions
    state machine for the webapp-skeleton backend."""

    def __init__(
        self,
        scope: Construct,
        construct_id: str,
        *,
        job_table: dynamodb.Table,
        clip_table: dynamodb.Table,
        refinement_table: dynamodb.Table,
        confirmed_selection_table: dynamodb.Table,
        confirmed_uploads_table: dynamodb.Table,
        connection_table: dynamodb.Table,
        raw_bucket: s3.Bucket,
        **kwargs,
    ) -> None:
        super().__init__(scope, construct_id, **kwargs)

        self._table_env = {
            "JOB_TABLE_NAME": job_table.table_name,
            "CLIP_TABLE_NAME": clip_table.table_name,
            "REFINEMENT_TABLE_NAME": refinement_table.table_name,
            "CONFIRMED_SELECTION_TABLE_NAME": confirmed_selection_table.table_name,
            "CONFIRMED_UPLOADS_TABLE_NAME": confirmed_uploads_table.table_name,
            "CONNECTION_TABLE_NAME": connection_table.table_name,
            "RAW_BUCKET_NAME": raw_bucket.bucket_name,
        }

        # ---- Task 3.1: Cognito User Pool + App Client ---------------------
        self.user_pool = cognito.UserPool(
            self,
            "UserPool",
            self_sign_up_enabled=True,
            sign_in_aliases=cognito.SignInAliases(email=True),
            removal_policy=RemovalPolicy.DESTROY,
        )
        self.user_pool_client = self.user_pool.add_client(
            "AppClient",
            auth_flows=cognito.AuthFlow(user_password=True, user_srp=True),
            generate_secret=False,
        )

        # ---- Lambda functions -----------------------------------------------
        upload_presign_fn = self._py_fn(
            "UploadPresignFn", "lambdas/upload_api/presign.py:handler"
        )
        upload_confirm_fn = self._py_fn(
            "UploadConfirmFn", "lambdas/upload_api/confirm.py:handler"
        )
        job_create_fn = self._py_fn(
            "JobCreateFn", "lambdas/job_api/create_job.py:handler"
        )
        job_get_fn = self._py_fn("JobGetFn", "lambdas/job_api/get_job.py:handler")
        highlights_list_fn = self._py_fn(
            "HighlightsListFn", "lambdas/highlights_api/list_clips.py:handler"
        )
        highlights_crop_fn = self._py_fn(
            "HighlightsCropFn", "lambdas/highlights_api/crop_confirm.py:handler"
        )
        highlights_refine_fn = self._py_fn(
            "HighlightsRefineFn", "lambdas/highlights_api/refinements.py:handler"
        )
        highlights_confirm_selection_fn = self._py_fn(
            "HighlightsConfirmSelectionFn",
            "lambdas/highlights_api/confirm_selection.py:handler",
        )
        highlights_handoff_fn = self._py_fn(
            "HighlightsHandoffFn", "lambdas/highlights_api/get_handoff.py:handler"
        )

        progress_authorizer_fn = self._py_fn(
            "ProgressAuthorizerFn", "lambdas/progress_api/authorizer.py:handler"
        )
        progress_connect_fn = self._py_fn(
            "ProgressConnectFn", "lambdas/progress_api/connect.py:handler"
        )
        progress_disconnect_fn = self._py_fn(
            "ProgressDisconnectFn", "lambdas/progress_api/disconnect.py:handler"
        )
        progress_subscribe_fn = self._py_fn(
            "ProgressSubscribeFn", "lambdas/progress_api/subscribe.py:handler"
        )

        # ---- Task 3.2: REST API with Cognito authorizer --------------------
        self.rest_api = apigateway.RestApi(
            self,
            "RestApi",
            deploy_options=apigateway.StageOptions(stage_name="prod"),
            default_cors_preflight_options=apigateway.CorsOptions(
                allow_origins=apigateway.Cors.ALL_ORIGINS,
                allow_methods=apigateway.Cors.ALL_METHODS,
            ),
        )
        cognito_authorizer = apigateway.CognitoUserPoolsAuthorizer(
            self, "RestCognitoAuthorizer", cognito_user_pools=[self.user_pool]
        )

        def _authed(method: str, resource, fn: lambda_.Function) -> None:
            resource.add_method(
                method,
                apigateway.LambdaIntegration(fn),
                authorizer=cognito_authorizer,
                authorization_type=apigateway.AuthorizationType.COGNITO,
            )

        # Task 13.1: wire REST routes to Lambda handlers, all behind Cognito.
        uploads = self.rest_api.root.add_resource("uploads")
        _authed("POST", uploads.add_resource("presign"), upload_presign_fn)
        _authed("POST", uploads.add_resource("confirm"), upload_confirm_fn)

        jobs = self.rest_api.root.add_resource("jobs")
        _authed("POST", jobs, job_create_fn)
        job_item = jobs.add_resource("{jobId}")
        _authed("GET", job_item, job_get_fn)

        clips = job_item.add_resource("clips")
        _authed("GET", clips, highlights_list_fn)
        clip_item = clips.add_resource("{clipId}")
        _authed("PATCH", clip_item, highlights_crop_fn)

        refinements = job_item.add_resource("refinements")
        _authed("POST", refinements, highlights_refine_fn)

        confirm_selection = job_item.add_resource("confirm-selection")
        _authed("POST", confirm_selection, highlights_confirm_selection_fn)

        # Handoff_Stub lookup is unauthenticated-by-design (bearer handoffId,
        # see get_handoff.py docstring) so it's not behind the authorizer.
        handoff = self.rest_api.root.add_resource("handoff")
        handoff.add_resource("{handoffId}").add_method(
            "GET", apigateway.LambdaIntegration(highlights_handoff_fn)
        )

        # ---- Task 3.3: WebSocket API with $connect authorizer -------------
        ws_authorizer = apigwv2_authorizers.WebSocketLambdaAuthorizer(
            "ProgressAuthorizer",
            progress_authorizer_fn,
            identity_source=["route.request.querystring.token"],
        )
        self.websocket_api = apigwv2.WebSocketApi(
            self,
            "ProgressApi",
            connect_route_options=apigwv2.WebSocketRouteOptions(
                integration=apigwv2_integrations.WebSocketLambdaIntegration(
                    "ConnectIntegration", progress_connect_fn
                ),
                authorizer=ws_authorizer,
            ),
            disconnect_route_options=apigwv2.WebSocketRouteOptions(
                integration=apigwv2_integrations.WebSocketLambdaIntegration(
                    "DisconnectIntegration", progress_disconnect_fn
                )
            ),
        )
        # Task 13.2: `subscribe` route.
        self.websocket_api.add_route(
            "subscribe",
            integration=apigwv2_integrations.WebSocketLambdaIntegration(
                "SubscribeIntegration", progress_subscribe_fn
            ),
        )
        self.websocket_stage = apigwv2.WebSocketStage(
            self,
            "ProgressApiStage",
            web_socket_api=self.websocket_api,
            stage_name="prod",
            auto_deploy=True,
        )

        management_endpoint = (
            f"https://{self.websocket_api.api_id}.execute-api."
            f"{self.region}.amazonaws.com/"
            f"{self.websocket_stage.stage_name}"
        )
        progress_management_env = {
            "PROGRESS_WS_MANAGEMENT_ENDPOINT": management_endpoint
        }
        for fn in (
            progress_connect_fn,
            progress_disconnect_fn,
            progress_subscribe_fn,
        ):
            for key, value in progress_management_env.items():
                fn.add_environment(key, value)

        management_connections_arn = (
            f"arn:{self.partition}:execute-api:{self.region}:{self.account}:"
            f"{self.websocket_api.api_id}/{self.websocket_stage.stage_name}/POST/@connections/*"
        )

        # ---- Task 11: ECS Fargate Setup for Pipeline Rendering -------------
        vpc = ec2.Vpc(self, "PipelineVpc", max_azs=2, nat_gateways=1)
        cluster = ecs.Cluster(self, "PipelineCluster", vpc=vpc)
        
        render_task_def = ecs.FargateTaskDefinition(
            self, "RenderTaskDef",
            memory_limit_mib=4096,
            cpu=1024,
        )
        
        render_task_def.add_container(
            "RenderContainer",
            image=ecs.ContainerImage.from_asset(BACKEND_ROOT, file="pipeline/Dockerfile"),
            logging=ecs.LogDrivers.aws_logs(stream_prefix="RenderContainer"),
            environment=self._table_env,
        )
        raw_bucket.grant_read_write(render_task_def.task_role)

        # ---- Task 12: Analysis_Stage_Stub Lambdas + state machine ---------
        NO_OP_STAGES = [
            "normalize/proxy",
            "transcript",
        ]
        no_op_fns = []
        for stage_name in NO_OP_STAGES:
            fn = self._py_fn(
                f"Stub{self._pascal(stage_name)}Fn",
                "lambdas/stage_stubs/no_op_stage.py:handler",
                extra_env={
                    "STAGE_NAME": stage_name,
                    **progress_management_env,
                },
            )
            no_op_fns.append((stage_name, fn))

        chat_analysis_fn = self._py_fn(
            "ChatAnalysisFn",
            "lambdas/pipeline_stages/chat.py:handler",
            extra_env=progress_management_env,
        )
        audio_analysis_fn = self._py_fn(
            "AudioAnalysisFn",
            "lambdas/pipeline_stages/audio.py:handler",
            extra_env=progress_management_env,
        )
        visual_analysis_fn = self._py_fn(
            "VisualAnalysisFn",
            "lambdas/pipeline_stages/visual.py:handler",
            extra_env=progress_management_env,
        )
        
        # Audio and visual analysis need the ffmpeg layer, but for now we just define it.
        # We will add the ffmpeg layer to them later.
        
        fusion_scoring_fn = self._py_fn(
            "FusionScoringFn",
            "lambdas/pipeline_stages/fusion.py:handler",
            extra_env=progress_management_env,
        )
        categorization_fn = self._py_fn(
            "DirectorCategorizationFn",
            "lambdas/pipeline_stages/director.py:handler",
            extra_env=progress_management_env,
        )
        set_status_in_progress_fn = self._py_fn(
            "SetJobInProgressFn",
            "lambdas/stage_stubs/set_job_status.py:handler",
            extra_env={"STATUS": "in_progress", **progress_management_env},
        )
        set_status_completed_fn = self._py_fn(
            "SetJobCompletedFn",
            "lambdas/stage_stubs/set_job_status.py:handler",
            extra_env={"STATUS": "completed", **progress_management_env},
        )
        set_status_failed_fn = self._py_fn(
            "SetJobFailedFn",
            "lambdas/stage_stubs/set_job_status.py:handler",
            extra_env={"STATUS": "failed", **progress_management_env},
        )

        for fn in (
            *[f for _, f in no_op_fns],
            chat_analysis_fn,
            audio_analysis_fn,
            visual_analysis_fn,
            fusion_scoring_fn,
            categorization_fn,
            set_status_in_progress_fn,
            set_status_completed_fn,
            set_status_failed_fn,
        ):
            connection_table.grant_read_data(fn)
            fn.add_to_role_policy(
                iam.PolicyStatement(
                    actions=["execute-api:ManageConnections"],
                    resources=[management_connections_arn],
                )
            )
        raw_bucket.grant_read_write(chat_analysis_fn)
        raw_bucket.grant_read_write(audio_analysis_fn)
        raw_bucket.grant_read_write(visual_analysis_fn)
        raw_bucket.grant_read_write(fusion_scoring_fn)
        raw_bucket.grant_read_write(categorization_fn)
        
        job_table.grant_read_write_data(set_status_in_progress_fn)
        job_table.grant_read_write_data(set_status_completed_fn)
        job_table.grant_read_write_data(set_status_failed_fn)
        clip_table.grant_read_write_data(fusion_scoring_fn)
        clip_table.grant_read_write_data(categorization_fn)

        set_job_failed_task = sfn_tasks.LambdaInvoke(
            self,
            "SetJobFailed",
            lambda_function=set_status_failed_fn,
            payload_response_only=True,
        ).next(
            sfn.Fail(self, "PipelineFailed", cause="A pipeline stage failed")
        )

        def _with_catch(task: sfn_tasks.LambdaInvoke) -> sfn_tasks.LambdaInvoke:
            return task.add_catch(set_job_failed_task, result_path="$.error")

        chain = _with_catch(
            sfn_tasks.LambdaInvoke(
                self,
                "SetJobInProgress",
                lambda_function=set_status_in_progress_fn,
                payload_response_only=True,
            )
        )
        for stage_name, fn in no_op_fns:
            step = _with_catch(
                sfn_tasks.LambdaInvoke(
                    self,
                    self._pascal(stage_name) + "Stub",
                    lambda_function=fn,
                    payload_response_only=True,
                )
            )
            chain = chain.next(step)
            
        chain = chain.next(
            _with_catch(
                sfn_tasks.LambdaInvoke(
                    self,
                    "ChatAnalysis",
                    lambda_function=chat_analysis_fn,
                    payload_response_only=True,
                )
            )
        ).next(
            _with_catch(
                sfn_tasks.LambdaInvoke(
                    self,
                    "AudioAnalysis",
                    lambda_function=audio_analysis_fn,
                    payload_response_only=True,
                )
            )
        )

        render_run_task = sfn_tasks.EcsRunTask(
            self,
            "RenderClipsFargateTask",
            integration_pattern=sfn.IntegrationPattern.RUN_JOB,
            cluster=cluster,
            task_definition=render_task_def,
            launch_type=ecs.LaunchType.FARGATE,
            container_overrides=[
                sfn_tasks.ContainerOverride(
                    container_definition=render_task_def.default_container,
                    environment=[
                        sfn_tasks.TaskEnvironmentVariable(
                            name="JOB_ID", value=sfn.JsonPath.string_at("$.jobId")
                        )
                    ],
                )
            ],
            result_path="$.renderResult",
        )

        chain = chain.next(
            _with_catch(
                sfn_tasks.LambdaInvoke(
                    self,
                    "VisualAnalysis",
                    lambda_function=visual_analysis_fn,
                    payload_response_only=True,
                )
            )
        ).next(
            _with_catch(
                sfn_tasks.LambdaInvoke(
                    self,
                    "FusionScoring",
                    lambda_function=fusion_scoring_fn,
                    payload_response_only=True,
                )
            )
        ).next(
            _with_catch(
                sfn_tasks.LambdaInvoke(
                    self,
                    "CategorizationAndDirector",
                    lambda_function=categorization_fn,
                    payload_response_only=True,
                )
            )
        ).next(
            _with_catch(render_run_task)
        ).next(
            sfn_tasks.LambdaInvoke(
                self,
                "SetJobCompleted",
                lambda_function=set_status_completed_fn,
                payload_response_only=True,
            )
        )

        self.state_machine = sfn.StateMachine(
            self,
            "PipelineOrchestrator",
            definition_body=sfn.DefinitionBody.from_chainable(chain),
        )

        # ---- Task 13.3: IAM permissions ------------------------------------
        confirmed_uploads_table.grant_read_write_data(upload_confirm_fn)
        raw_bucket.grant_put(upload_presign_fn)
        raw_bucket.grant_read(upload_confirm_fn)
        raw_bucket.grant_read(highlights_list_fn)
        raw_bucket.grant_read(highlights_handoff_fn)

        job_table.grant_read_write_data(job_create_fn)
        confirmed_uploads_table.grant_read_data(job_create_fn)
        self.state_machine.grant_start_execution(job_create_fn)
        job_create_fn.add_environment(
            "STATE_MACHINE_ARN", self.state_machine.state_machine_arn
        )

        job_table.grant_read_data(job_get_fn)

        job_table.grant_read_data(highlights_list_fn)
        clip_table.grant_read_data(highlights_list_fn)

        job_table.grant_read_data(highlights_crop_fn)
        clip_table.grant_read_write_data(highlights_crop_fn)

        job_table.grant_read_data(highlights_refine_fn)
        refinement_table.grant_read_write_data(highlights_refine_fn)

        job_table.grant_read_data(highlights_confirm_selection_fn)
        confirmed_selection_table.grant_read_write_data(
            highlights_confirm_selection_fn
        )

        confirmed_selection_table.grant_read_data(highlights_handoff_fn)
        clip_table.grant_read_data(highlights_handoff_fn)

        job_table.grant_read_data(progress_subscribe_fn)
        connection_table.grant_read_write_data(progress_connect_fn)
        connection_table.grant_read_write_data(progress_disconnect_fn)
        connection_table.grant_read_write_data(progress_subscribe_fn)

    def _py_fn(
        self, construct_id: str, handler: str, extra_env: dict | None = None
    ) -> lambda_.Function:
        """`handler` is given as "lambdas/pkg/module.py:function" (matching
        how the module is referenced elsewhere in this file/tests); Lambda's
        own dotted-handler resolution needs "lambdas.pkg.module.function"
        instead, so translate it here."""
        env = dict(self._table_env)
        if extra_env:
            env.update(extra_env)
        module_path, function_name = handler.split(":")
        dotted_module = module_path.replace("/", ".").removesuffix(".py")
        return lambda_.Function(
            self,
            construct_id,
            runtime=lambda_.Runtime.PYTHON_3_12,
            handler=f"{dotted_module}.{function_name}",
            code=lambda_.Code.from_asset(
                BACKEND_ROOT,
                exclude=[
                    ".venv",
                    "cdk.out",
                    "tests",
                    "__pycache__",
                    "*.pyc",
                    ".pytest_cache",
                ],
            ),
            timeout=Duration.seconds(30),
            environment=env,
        )

    @staticmethod
    def _pascal(text: str) -> str:
        return "".join(word.capitalize() for word in text.replace("/", " ").split())
