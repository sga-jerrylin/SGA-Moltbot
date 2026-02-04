
import { createSearxngSgaTool } from "../src/agents/tools/searxng-sga-tool.js";

async function main() {
  console.log("Testing SearXNG-SGA Tool...");

  // Instantiate the tool
  // We don't need full config for this test as the tool has a default URL
  const tool = createSearxngSgaTool();

  if (!tool) {
    console.error("Failed to create tool");
    process.exit(1);
  }

  console.log(`Tool created: ${tool.name}`);
  console.log(`Description: ${tool.description}`);

  // Test Case 1: General Chinese Search
  console.log("\n--- Test Case 1: Chinese Search (Default) ---");
  try {
    const result = await tool.execute("test-1", {
      query: "OpenAI",
      count: 3
    });

    // The result is a JSON string, parse it to see details
    const parsed = JSON.parse(result.content[0].text);
    console.log("Result:", JSON.stringify(parsed, null, 2));

    if (parsed.results && parsed.results.length > 0) {
      console.log("✅ Chinese search returned results.");
    } else {
      console.warn("⚠️ Chinese search returned no results.");
    }
  } catch (err) {
    console.error("❌ Chinese search failed:", err);
  }

  // Test Case 2: WeChat Search
  console.log("\n--- Test Case 2: WeChat Search ---");
  try {
    const result = await tool.execute("test-2", {
      query: "人工智能",
      mode: "wechat",
      count: 2
    });

    const parsed = JSON.parse(result.content[0].text);
    console.log("Result:", JSON.stringify(parsed, null, 2));

    if (parsed.results && parsed.results.length > 0) {
      console.log("✅ WeChat search returned results.");
    } else {
      console.warn("⚠️ WeChat search returned no results.");
    }
  } catch (err) {
    console.error("❌ WeChat search failed:", err);
  }
}

main().catch(console.error);
