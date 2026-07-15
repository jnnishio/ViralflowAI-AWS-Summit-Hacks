import os
import boto3
from botocore.exceptions import ClientError

def setup_dev_user():
    # Read the client ID and pool ID from frontend/.env
    env_file = os.path.join(os.path.dirname(__file__), "..", "frontend", ".env")
    
    pool_id = None
    client_id = None
    
    try:
        with open(env_file, "r") as f:
            for line in f:
                if line.startswith("VITE_COGNITO_USER_POOL_ID="):
                    pool_id = line.strip().split("=")[1]
                elif line.startswith("VITE_COGNITO_CLIENT_ID="):
                    client_id = line.strip().split("=")[1]
    except FileNotFoundError:
        print(f"Error: {env_file} not found.")
        return
                
    if not pool_id or not client_id:
        print("Could not find VITE_COGNITO_USER_POOL_ID or VITE_COGNITO_CLIENT_ID in frontend/.env")
        return
        
    cognito = boto3.client("cognito-idp", region_name=pool_id.split("_")[0])
    
    username = "dev-user@example.com"
    password = "DevPassword123!"
    
    print(f"Creating/updating {username} in {pool_id}...")
    
    try:
        cognito.admin_create_user(
            UserPoolId=pool_id,
            Username=username,
            UserAttributes=[
                {"Name": "email", "Value": username},
                {"Name": "email_verified", "Value": "true"}
            ],
            MessageAction="SUPPRESS"
        )
        print("User created.")
    except ClientError as e:
        if e.response['Error']['Code'] == 'UsernameExistsException':
            print("User already exists.")
        else:
            raise e
            
    # Set permanent password
    cognito.admin_set_user_password(
        UserPoolId=pool_id,
        Username=username,
        Password=password,
        Permanent=True
    )
    print("Password set permanently.")
    
    print("\nDone! The React app will automatically use these credentials in dev mode.")

if __name__ == "__main__":
    setup_dev_user()
