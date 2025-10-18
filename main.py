import json
import boto3
import os
import uuid
from datetime import datetime, timezone
from urllib.parse import urlencode
import urllib3
from botocore.exceptions import ClientError, BotoCoreError

# Initialize AWS clients
dynamodb = boto3.resource('dynamodb')
s3_client = boto3.client('s3')
bedrock_client = boto3.client('bedrock-runtime')

# Environment variables
PROFILES_TABLE = os.environ.get('PROFILES_TABLE')
CART_ITEMS_TABLE = os.environ.get('CART_ITEMS_TABLE')
FITS_TABLE = os.environ.get('FITS_TABLE')
ASSETS_BUCKET = os.environ.get('ASSETS_BUCKET')
COGNITO_DOMAIN = os.environ.get('COGNITO_DOMAIN')
COGNITO_CLIENT_ID = os.environ.get('COGNITO_CLIENT_ID')

# Shared utilities
def get_user_id(event):
    """Extract user ID from API Gateway authorizer context"""
    try:
        return event['requestContext']['authorizer']['claims']['sub']
    except KeyError:
        raise ValueError("User ID not found in request context")

def create_response(status_code, body, headers=None):
    """Create standardized API Gateway response"""
    default_headers = {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type,Authorization',
        'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS'
    }
    if headers:
        default_headers.update(headers)
    
    return {
        'statusCode': status_code,
        'headers': default_headers,
        'body': json.dumps(body)
    }

def create_error_response(status_code, error_type, message, details=None):
    """Create standardized error response"""
    error_body = {
        'error': error_type,
        'message': message
    }
    if details:
        error_body['details'] = details
    
    return create_response(status_code, error_body)

def get_current_timestamp():
    """Get current ISO 8601 timestamp"""
    return datetime.now(timezone.utc).isoformat()

# 1. GET /upload-url - Generate presigned S3 PUT URL
def upload_url_handler(event, context):
    """Generate presigned S3 PUT URL for image uploads"""
    try:
        # Get user ID
        user_id = get_user_id(event)
        
        # Get and validate query parameters
        query_params = event.get('queryStringParameters') or {}
        image_type = query_params.get('type')
        
        if not image_type or image_type not in ['face', 'body', 'other']:
            return create_error_response(400, 'INVALID_PARAMETER', 
                                       'type parameter must be one of: face, body, other')
        
        # Generate unique S3 object key
        unique_id = str(uuid.uuid4())
        object_key = f"uploads/{user_id}/{image_type}/{unique_id}.jpg"
        
        # Generate presigned URL with conditions
        presigned_url = s3_client.generate_presigned_url(
            'put_object',
            Params={
                'Bucket': ASSETS_BUCKET,
                'Key': object_key,
                'ContentType': 'image/jpeg'
            },
            Conditions=[
                ['content-length-range', 1, 10485760],  # 1 byte to 10MB
                ['starts-with', '$Content-Type', 'image/']
            ],
            ExpiresIn=300  # 5 minutes
        )
        
        return create_response(200, {
            'url': presigned_url,
            'key': object_key
        })
        
    except ValueError as e:
        return create_error_response(401, 'UNAUTHORIZED', str(e))
    except ClientError as e:
        return create_error_response(500, 'S3_ERROR', 'Failed to generate upload URL')
    except Exception as e:
        return create_error_response(500, 'INTERNAL_ERROR', 'An unexpected error occurred')

# 2. POST /profile - Create or update user profile
def profile_handler(event, context):
    """Create or update user measurements and preferences"""
    try:
        # Get user ID
        user_id = get_user_id(event)
        
        # Parse request body
        try:
            body = json.loads(event['body'])
        except (json.JSONDecodeError, TypeError):
            return create_error_response(400, 'INVALID_JSON', 'Request body must be valid JSON')
        
        # Validate required numeric fields
        required_fields = ['height_cm', 'weight_kg', 'chest_cm', 'waist_cm', 'hips_cm', 'inseam_cm']
        for field in required_fields:
            if field not in body:
                return create_error_response(400, 'MISSING_FIELD', f'Required field missing: {field}')
            
            value = body[field]
            if not isinstance(value, (int, float)) or value <= 0 or value > 300:
                return create_error_response(400, 'INVALID_VALUE', 
                                           f'{field} must be a positive number less than 300')
        
        # Validate preferred_fit
        if 'preferred_fit' not in body:
            return create_error_response(400, 'MISSING_FIELD', 'Required field missing: preferred_fit')
        
        # Prepare profile data
        profile_data = {
            'user_id': user_id,
            'height_cm': body['height_cm'],
            'weight_kg': body['weight_kg'],
            'chest_cm': body['chest_cm'],
            'waist_cm': body['waist_cm'],
            'hips_cm': body['hips_cm'],
            'inseam_cm': body['inseam_cm'],
            'preferred_fit': body['preferred_fit'],
            'updatedAt': get_current_timestamp()
        }
        
        # Add optional avatar_key if provided
        if 'avatar_key' in body:
            profile_data['avatar_key'] = body['avatar_key']
        
        # Store in DynamoDB
        table = dynamodb.Table(PROFILES_TABLE)
        table.put_item(Item=profile_data)
        
        return create_response(200, {
            'ok': True,
            'profile': profile_data
        })
        
    except ValueError as e:
        return create_error_response(401, 'UNAUTHORIZED', str(e))
    except ClientError as e:
        return create_error_response(500, 'DYNAMODB_ERROR', 'Failed to save profile')
    except Exception as e:
        return create_error_response(500, 'INTERNAL_ERROR', 'An unexpected error occurred')

# 3. POST /cart - Add or update cart item
def cart_post_handler(event, context):
    """Add or update a cart item from product page"""
    try:
        # Get user ID
        user_id = get_user_id(event)
        
        # Parse request body
        try:
            body = json.loads(event['body'])
        except (json.JSONDecodeError, TypeError):
            return create_error_response(400, 'INVALID_JSON', 'Request body must be valid JSON')
        
        # Validate required fields
        required_fields = ['retailer', 'productId', 'title', 'price_cents', 'currency', 
                          'productUrl', 'imageUrl', 'selectedSize', 'color', 'category']
        
        for field in required_fields:
            if field not in body:
                return create_error_response(400, 'MISSING_FIELD', f'Required field missing: {field}')
        
        # Validate price_cents is numeric
        if not isinstance(body['price_cents'], (int, float)) or body['price_cents'] < 0:
            return create_error_response(400, 'INVALID_VALUE', 'price_cents must be a non-negative number')
        
        # Create composite sort key
        item_key = f"{body['retailer']}#{body['productId']}"
        current_time = get_current_timestamp()
        
        table = dynamodb.Table(CART_ITEMS_TABLE)
        
        # Use UpdateItem for more precise control
        table.update_item(
            Key={
                'user_id': user_id,
                'item_key': item_key
            },
            UpdateExpression="SET "
                "retailer = :r, productId = :pid, title = :t, price_cents = :p, "
                "currency = :c, productUrl = :pu, imageUrl = :iu, "
                "selectedSize = :ss, color = :col, category = :cat, "
                "updatedAt = :ts, "
                "addedAt = if_not_exists(addedAt, :ts)", # This is the magic line
            ExpressionAttributeValues={
                ':r': body['retailer'],
                ':pid': body['productId'],
                ':t': body['title'],
                ':p': body['price_cents'],
                ':c': body['currency'],
                ':pu': body['productUrl'],
                ':iu': body['imageUrl'],
                ':ss': body['selectedSize'],
                ':col': body['color'],
                ':cat': body['category'],
                ':ts': current_time # Use the same timestamp for updatedAt and addedAt
            }
        )
        
        return create_response(200, {'ok': True})
        
    except ValueError as e:
        return create_error_response(401, 'UNAUTHORIZED', str(e))
    except ClientError as e:
        return create_error_response(500, 'DYNAMODB_ERROR', 'Failed to save cart item')
    except Exception as e:
        return create_error_response(500, 'INTERNAL_ERROR', 'An unexpected error occurred')

# 4. GET /cart - List user's cart items
def cart_get_handler(event, context):
    """List the user's cart items with pagination"""
    try:
        # Get user ID
        user_id = get_user_id(event)
        
        # Get pagination cursor from query parameters
        query_params = event.get('queryStringParameters') or {}
        cursor = query_params.get('cursor')
        
        # Prepare query parameters
        query_kwargs = {
            'KeyConditionExpression': 'user_id = :user_id',
            'ExpressionAttributeValues': {':user_id': user_id}
        }
        
        # Add pagination if cursor provided
        if cursor:
            try:
                # Decode cursor (in real implementation, you'd want to encrypt/sign this)
                import base64
                decoded_cursor = json.loads(base64.b64decode(cursor).decode())
                query_kwargs['ExclusiveStartKey'] = decoded_cursor
            except Exception:
                return create_error_response(400, 'INVALID_CURSOR', 'Invalid pagination cursor')
        
        # Query DynamoDB
        table = dynamodb.Table(CART_ITEMS_TABLE)
        response = table.query(**query_kwargs)
        
        # Prepare response
        items = response.get('Items', [])
        next_cursor = None
        
        if 'LastEvaluatedKey' in response:
            # Encode cursor for next page
            import base64
            cursor_data = base64.b64encode(json.dumps(response['LastEvaluatedKey']).encode()).decode()
            next_cursor = cursor_data
        
        return create_response(200, {
            'items': items,
            'nextCursor': next_cursor
        })
        
    except ValueError as e:
        return create_error_response(401, 'UNAUTHORIZED', str(e))
    except ClientError as e:
        return create_error_response(500, 'DYNAMODB_ERROR', 'Failed to retrieve cart items')
    except Exception as e:
        return create_error_response(500, 'INTERNAL_ERROR', 'An unexpected error occurred')# 5. POST /f
#it - Create new fit generation job
def fit_create_handler(event, context):
    """Create a new fit generation job from selected items"""
    try:
        # Get user ID
        user_id = get_user_id(event)
        
        # Parse request body
        try:
            body = json.loads(event['body'])
        except (json.JSONDecodeError, TypeError):
            return create_error_response(400, 'INVALID_JSON', 'Request body must be valid JSON')
        
        # Validate required fields
        if 'items' not in body or not isinstance(body['items'], list):
            return create_error_response(400, 'MISSING_FIELD', 'items array is required')
        
        if 'mode' not in body or body['mode'] not in ['MVP_COMPOSITE', 'BEDROCK']:
            return create_error_response(400, 'INVALID_MODE', 'mode must be MVP_COMPOSITE or BEDROCK')
        
        # Validate items array
        for item in body['items']:
            if not isinstance(item, dict) or 'retailer' not in item or 'productId' not in item:
                return create_error_response(400, 'INVALID_ITEMS', 
                                           'Each item must have retailer and productId')
        
        # Generate unique fit ID
        fit_id = str(uuid.uuid4())
        
        # Prepare fit data
        fit_data = {
            'fitId': fit_id,
            'user_id': user_id,
            'items': body['items'],
            'mode': body['mode'],
            'status': 'PENDING',
            'createdAt': get_current_timestamp(),
            'updatedAt': get_current_timestamp()
        }
        
        # Add optional fields
        if 'name' in body:
            fit_data['name'] = body['name']
        if 'body_asset_key' in body:
            fit_data['body_asset_key'] = body['body_asset_key']
        
        # Store initial record in DynamoDB
        table = dynamodb.Table(FITS_TABLE)
        table.put_item(Item=fit_data)
        
        # Handle different modes
        if body['mode'] == 'BEDROCK':
            # For Bedrock mode, just return PENDING status
            # Actual processing would be handled by separate async process
            return create_response(201, {
                'fitId': fit_id,
                'status': 'PENDING'
            })
        
        elif body['mode'] == 'MVP_COMPOSITE':
            # For MVP mode, perform simple synchronous processing
            try:
                # Skeleton implementation for MVP composite
                # In real implementation, you'd use PIL/Pillow for image compositing
                generated_key = f"generated/{user_id}/{fit_id}.jpg"
                
                # Simulate image generation (replace with actual PIL logic)
                # composite_image = create_composite_image(body['items'], body.get('body_asset_key'))
                # s3_client.put_object(Bucket=ASSETS_BUCKET, Key=generated_key, Body=composite_image)
                
                # Update fit record with READY status
                table.update_item(
                    Key={'fitId': fit_id},
                    UpdateExpression='SET #status = :status, imageUrl = :imageUrl, updatedAt = :updatedAt',
                    ExpressionAttributeNames={'#status': 'status'},
                    ExpressionAttributeValues={
                        ':status': 'READY',
                        ':imageUrl': generated_key,
                        ':updatedAt': get_current_timestamp()
                    }
                )
                
                return create_response(201, {
                    'fitId': fit_id,
                    'status': 'READY'
                })
                
            except Exception as e:
                # Update fit record with FAILED status
                table.update_item(
                    Key={'fitId': fit_id},
                    UpdateExpression='SET #status = :status, updatedAt = :updatedAt',
                    ExpressionAttributeNames={'#status': 'status'},
                    ExpressionAttributeValues={
                        ':status': 'FAILED',
                        ':updatedAt': get_current_timestamp()
                    }
                )
                return create_error_response(500, 'GENERATION_FAILED', 'Failed to generate fit')
        
    except ValueError as e:
        return create_error_response(401, 'UNAUTHORIZED', str(e))
    except ClientError as e:
        return create_error_response(500, 'DYNAMODB_ERROR', 'Failed to create fit job')
    except Exception as e:
        return create_error_response(500, 'INTERNAL_ERROR', 'An unexpected error occurred')

# 6. GET /fit/{fitId} - Retrieve fit status and image
def fit_get_handler(event, context):
    """Retrieve fit status and image link"""
    try:
        # Get user ID
        user_id = get_user_id(event)
        
        # Get fit ID from path parameters
        fit_id = event['pathParameters']['fitId']
        if not fit_id:
            return create_error_response(400, 'MISSING_PARAMETER', 'fitId is required')
        
        # Fetch fit from DynamoDB
        table = dynamodb.Table(FITS_TABLE)
        response = table.get_item(Key={'fitId': fit_id})
        
        if 'Item' not in response:
            return create_error_response(404, 'FIT_NOT_FOUND', 'Fit not found')
        
        fit_item = response['Item']
        
        # Verify user ownership
        if fit_item['user_id'] != user_id:
            return create_error_response(403, 'FORBIDDEN', 'Access denied to this fit')
        
        # Prepare response data
        response_data = {
            'fitId': fit_item['fitId'],
            'status': fit_item['status'],
            'items': fit_item['items'],
            'createdAt': fit_item['createdAt'],
            'updatedAt': fit_item['updatedAt'],
            'imageUrl': None
        }
        
        # Add optional fields
        if 'name' in fit_item:
            response_data['name'] = fit_item['name']
        
        # Generate presigned URL if fit is ready
        if fit_item['status'] == 'READY' and 'imageUrl' in fit_item:
            try:
                presigned_url = s3_client.generate_presigned_url(
                    'get_object',
                    Params={
                        'Bucket': ASSETS_BUCKET,
                        'Key': fit_item['imageUrl']
                    },
                    ExpiresIn=3600  # 1 hour
                )
                response_data['imageUrl'] = presigned_url
            except ClientError:
                # If presigned URL generation fails, continue without it
                pass
        
        return create_response(200, response_data)
        
    except ValueError as e:
        return create_error_response(401, 'UNAUTHORIZED', str(e))
    except ClientError as e:
        return create_error_response(500, 'DYNAMODB_ERROR', 'Failed to retrieve fit')
    except Exception as e:
        return create_error_response(500, 'INTERNAL_ERROR', 'An unexpected error occurred')

# 7. GET /fits - List recent fits for user
def fits_list_handler(event, context):
    """List recent fits for the user"""
    try:
        # Get user ID
        user_id = get_user_id(event)
        
        # Query fits table using GSI on user_id
        # Note: This assumes a GSI exists with user_id as partition key and createdAt as sort key
        table = dynamodb.Table(FITS_TABLE)
        
        # For this implementation, we'll scan and filter (not optimal for production)
        # In production, use a GSI with user_id as partition key
        response = table.query(
            IndexName='UserFitsByDate-Index', # The GSI you created
            KeyConditionExpression='user_id = :user_id',
            ExpressionAttributeValues={':user_id': user_id},
            ScanIndexForward=False, # Sorts by createdAt (newest first)
            Limit=20
        )

        # response = table.scan(
        #     FilterExpression='user_id = :user_id',
        #     ExpressionAttributeValues={':user_id': user_id},
        #     Limit=20
        # )
        
        fits = []
        for item in response.get('Items', []):
            fit_summary = {
                'fitId': item['fitId'],
                'createdAt': item['createdAt'],
                'status': item['status'],
                'thumbnailUrl': None
            }
            
            # Add optional name
            if 'name' in item:
                fit_summary['name'] = item['name']
            
            # Generate thumbnail URL for ready fits
            if item['status'] == 'READY' and 'imageUrl' in item:
                try:
                    # Assume thumbnail exists with _thumb suffix
                    thumbnail_key = item['imageUrl'].replace('.jpg', '_thumb.jpg')
                    thumbnail_url = s3_client.generate_presigned_url(
                        'get_object',
                        Params={
                            'Bucket': ASSETS_BUCKET,
                            'Key': thumbnail_key
                        },
                        ExpiresIn=3600  # 1 hour
                    )
                    fit_summary['thumbnailUrl'] = thumbnail_url
                except ClientError:
                    # If thumbnail doesn't exist or fails, continue without it
                    pass
            
            fits.append(fit_summary)
        
        # Sort by createdAt descending (most recent first)
        #fits.sort(key=lambda x: x['createdAt'], reverse=True)
        
        return create_response(200, {'fits': fits})
        
    except ValueError as e:
        return create_error_response(401, 'UNAUTHORIZED', str(e))
    except ClientError as e:
        return create_error_response(500, 'DYNAMODB_ERROR', 'Failed to retrieve fits')
    except Exception as e:
        return create_error_response(500, 'INTERNAL_ERROR', 'An unexpected error occurred')

# 8. POST /token - Exchange authorization code for tokens
def token_handler(event, context):
    """Exchange Cognito authorization code for tokens using PKCE"""
    try:
        # Parse request body
        try:
            body = json.loads(event['body'])
        except (json.JSONDecodeError, TypeError):
            return create_error_response(400, 'INVALID_JSON', 'Request body must be valid JSON')
        
        # Validate required fields
        required_fields = ['code', 'redirectUri', 'codeVerifier']
        for field in required_fields:
            if field not in body:
                return create_error_response(400, 'MISSING_FIELD', f'Required field missing: {field}')
        
        # Prepare token exchange request
        token_data = {
            'grant_type': 'authorization_code',
            'client_id': COGNITO_CLIENT_ID,
            'code': body['code'],
            'redirect_uri': body['redirectUri'],
            'code_verifier': body['codeVerifier']
        }
        
        # Make request to Cognito token endpoint
        http = urllib3.PoolManager()
        
        token_url = f"https://{COGNITO_DOMAIN}/oauth2/token"
        encoded_data = urlencode(token_data)
        
        response = http.request(
            'POST',
            token_url,
            body=encoded_data,
            headers={
                'Content-Type': 'application/x-www-form-urlencoded'
            }
        )
        
        # Parse Cognito response
        response_data = json.loads(response.data.decode('utf-8'))
        
        # Return Cognito response with appropriate status code
        if response.status == 200:
            return create_response(200, response_data)
        else:
            return create_response(response.status, response_data)
        
    except json.JSONDecodeError:
        return create_error_response(500, 'COGNITO_ERROR', 'Invalid response from Cognito')
    except Exception as e:
        return create_error_response(500, 'INTERNAL_ERROR', 'Token exchange failed')

# --- MAIN LAMBDA ROUTER ---

def lambda_handler(event, context):
    """
    Main entry point for API Gateway.
    Routes requests to the correct handler based on method and path.
    """
    try:
        method = event['httpMethod']
        resource = event['resource'] # e.g., /profile, /fit/{fitId}

        # Handle CORS pre-flight OPTIONS requests
        if method == 'OPTIONS':
            return create_response(204, {}) # 204 No Content is common for OPTIONS

        # --- Define Your Routes ---
        if resource == '/upload-url' and method == 'GET':
            return upload_url_handler(event, context)
            
        elif resource == '/profile' and method == 'POST':
            return profile_handler(event, context)
            
        elif resource == '/cart' and method == 'POST':
            return cart_post_handler(event, context)
            
        elif resource == '/cart' and method == 'GET':
            return cart_get_handler(event, context)
            
        elif resource == '/fit' and method == 'POST':
            return fit_create_handler(event, context)
            
        elif resource == '/fit/{fitId}' and method == 'GET':
            return fit_get_handler(event, context)
            
        elif resource == '/fits' and method == 'GET':
            return fits_list_handler(event, context)
            
        elif resource == '/token' and method == 'POST':
            return token_handler(event, context)
            
        else:
            return create_error_response(404, 'NOT_FOUND', 'The requested resource was not found')

    except Exception as e:
        # Catch-all for any unhandled exceptions
        print(f"UNHANDLED EXCEPTION: {e}")
        return create_error_response(500, 'INTERNAL_ERROR', 'An unexpected internal error occurred')




# Helper function for MVP composite image generation (skeleton)
def create_composite_image(items, body_asset_key=None):
    """
    Skeleton function for MVP composite image generation
    In a real implementation, this would use PIL/Pillow to composite images
    """
    # This is a placeholder - implement actual image compositing logic here
    # Example using PIL:
    # from PIL import Image, ImageDraw
    # 
    # # Load base image (user's body or default avatar)
    # if body_asset_key:
    #     base_image = load_image_from_s3(body_asset_key)
    # else:
    #     base_image = create_default_avatar()
    # 
    # # Load and composite clothing items
    # for item in items:
    #     clothing_image = load_clothing_image(item)
    #     base_image = composite_clothing(base_image, clothing_image, item['category'])
    # 
    # return base_image.tobytes()
    
    # For now, return placeholder
    return b"placeholder_composite_image_data"