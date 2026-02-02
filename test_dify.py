import urllib.request
import json
import sys

# 配置部分
BASE_URL = "https://win-f94n2ocbbcl.tail1f89a2.ts.net"
API_KEY = "app-fee5ede4e15ea503c8b0d2383bddf5a48bc76334a070b14f7f2d7c844518ee41"

# 移除末尾斜杠
if BASE_URL.endswith('/'):
    BASE_URL = BASE_URL[:-1]

URL = f"{BASE_URL}/api/dify-compat/v1/chat-messages"

def test_dify():
    print(f"Testing URL: {URL}")
    print("Sending request...")

    data = {
        "query": "Hello, are you online?",
        "inputs": {},
        "response_mode": "blocking",  # 使用阻塞模式以便于查看结果
        "user": "test-user-123",
        "conversation_id": ""
    }

    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {API_KEY}"
    }

    try:
        req = urllib.request.Request(
            URL,
            data=json.dumps(data).encode('utf-8'),
            headers=headers,
            method="POST"
        )

        with urllib.request.urlopen(req) as response:
            print(f"Status Code: {response.status}")
            body = response.read().decode('utf-8')
            print("-" * 30)
            print("Response Body:")
            print(body)
            print("-" * 30)

            # 尝试解析 JSON
            try:
                json_body = json.loads(body)
                print("✅ Success! Valid JSON response received.")
                if 'answer' in json_body:
                    print(f"🤖 Answer: {json_body['answer']}")
            except:
                print("Received non-JSON response.")

    except urllib.error.HTTPError as e:
        print(f"❌ HTTP Error: {e.code} {e.reason}")
        error_body = e.read().decode('utf-8')
        print(f"Error Details: {error_body}")
    except urllib.error.URLError as e:
        print(f"❌ Connection Error: {e.reason}")
        print("Tip: Make sure you are connected to Tailscale and the address is correct.")
    except Exception as e:
        print(f"❌ Unexpected Error: {e}")

if __name__ == "__main__":
    test_dify()
