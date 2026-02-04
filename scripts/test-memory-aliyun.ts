
const API_KEY = "sk-a2e7b59004734cd7b06dd246bc72c30b";
const BASE_URL = "https://dashscope.aliyuncs.com/compatible-mode/v1";
const MODEL = "text-embedding-v3";

async function testMemoryEmbedding() {
  console.log("Testing Aliyun Qwen Embedding for Memory Search (via fetch)...");
  console.log(`Endpoint: ${BASE_URL}/embeddings`);
  console.log(`Model: ${MODEL}`);

  const testText = "OpenClaw memory test: This is a test string to verify embedding generation.";

  try {
    console.log(`\nGenerating embedding for: "${testText}"`);
    const startTime = Date.now();

    const response = await fetch(`${BASE_URL}/embeddings`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${API_KEY}`
      },
      body: JSON.stringify({
        model: MODEL,
        input: testText
      })
    });

    const duration = Date.now() - startTime;

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`API Error (${response.status}): ${errorText}`);
    }

    const data = await response.json();
    const embedding = data.data[0].embedding;

    console.log(`\n✅ Success!`);
    console.log(`Latency: ${duration}ms`);
    console.log(`Embedding Dimensions: ${embedding.length}`);
    console.log(`First 5 dimensions: ${embedding.slice(0, 5).join(", ")}...`);

    if (embedding.length > 0) {
        console.log("\nMemory configuration is valid and ready to be enabled.");
    }

  } catch (error) {
    console.error("\n❌ Error testing embedding:");
    console.error(error);
    process.exit(1);
  }
}

testMemoryEmbedding();
