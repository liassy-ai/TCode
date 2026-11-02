

import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";

const agentDir = process.env.PI_CODING_AGENT_DIR!;
const authPath = join(agentDir, "auth.json");
const modelsPath = join(agentDir, "models.json");

async function status(runtime: ModelRuntime) {
  const s = runtime.getProviderAuthStatus("google-vertex");
  console.log("  status:", JSON.stringify(s));
}

async function main() {
  await mkdir(agentDir, { recursive: true });
  await writeFile(join(agentDir, "models.json"), "{}\n");
  await writeFile(join(agentDir, "auth.json"), "{}\n");

  console.log("== 1) 无任何凭证 ==");
  const runtime = await ModelRuntime.create({ allowModelNetwork: false, refreshOnCreate: false });
  await status(runtime);
  const avail = await runtime.getAvailable("google-vertex");
  console.log("  vertex 可用模型数:", avail.length);


  console.log("== 2) auth.json 写假 api_key（UI 编辑表单保存路径） ==");
  await writeFile(authPath, JSON.stringify({ "google-vertex": { type: "api_key", key: "fake-vertex-api-key" } }, null, 2));
  await runtime.refresh({ allowNetwork: false });
  await status(runtime);
  const avail2 = await runtime.getAvailable("google-vertex");
  console.log("  vertex 可用模型数:", avail2.length, avail2.slice(0, 3).map((m) => m.id).join(", "));


  console.log("== 3) 假 key 真实请求（观测端点与错误） ==");
  try {
    const model = runtime.getModel("google-vertex", avail2[0].id);
    const stream = runtime.stream(model, {
      systemPrompt: "",
      messages: [{ role: "user", content: "hi" }],
    });
    for await (const ev of stream) {
      if (ev.type === "error") {
        console.log("  ERROR:", ev.error.errorMessage);
      } else if (ev.type === "text_delta") {
        console.log("  delta:", JSON.stringify(ev.delta).slice(0, 80));
      }
    }
  } catch (e) {
    console.log("  threw:", e instanceof Error ? e.message : String(e));
  }


  console.log("== 4) 仅 env project/location（无 ADC 文件） ==");
  process.env.GOOGLE_CLOUD_PROJECT = "fake-project";
  process.env.GOOGLE_CLOUD_LOCATION = "us-central1";
  delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
  await writeFile(authPath, "{}\n");
  const runtime2 = await ModelRuntime.create({ allowModelNetwork: false, refreshOnCreate: false, authPath });
  await status(runtime2);
  delete process.env.GOOGLE_CLOUD_PROJECT;
  delete process.env.GOOGLE_CLOUD_LOCATION;


  console.log("== 5) auth.json 存 ADC 形态 credential（模拟 CLI /login service-account 路径） ==");
  const fakeCreds = join(agentDir, "fake-sa.json");
  await writeFile(
    fakeCreds,
    JSON.stringify({
      type: "service_account",
      project_id: "fake-project",
      client_email: "probe@fake-project.iam.gserviceaccount.com",
      private_key: "-----BEGIN PRIVATE KEY-----\\nFAKE\\n-----END PRIVATE KEY-----\\n",
    }),
  );
  await writeFile(
    authPath,
    JSON.stringify(
      {
        "google-vertex": {
          type: "api_key",
          env: {
            GOOGLE_CLOUD_PROJECT: "fake-project",
            GOOGLE_CLOUD_LOCATION: "us-central1",
            GOOGLE_APPLICATION_CREDENTIALS: fakeCreds,
          },
        },
      },
      null,
      2,
    ),
  );
  const runtime3 = await ModelRuntime.create({ allowModelNetwork: false, refreshOnCreate: false, authPath });
  await runtime3.refresh({ allowNetwork: false });
  await status(runtime3);


  console.log("== 6) ADC 假凭据真实请求（观测端点与错误形态） ==");
  try {
    const avail3 = await runtime3.getAvailable("google-vertex");
    const model = runtime3.getModel("google-vertex", avail3[0].id);
    const stream = runtime3.stream(model, {
      systemPrompt: "",
      messages: [{ role: "user", content: "hi" }],
    });
    for await (const ev of stream) {
      if (ev.type === "error") {
        console.log("  ERROR:", (ev.error.errorMessage ?? "").slice(0, 400));
      }
    }
  } catch (e) {
    console.log("  threw:", e instanceof Error ? e.message : String(e));
  }


  console.log("== 7) 对照组：Gemini API 假 key（应命中 Gemini 端点，报 API key 无效而非“不支持”） ==");
  await writeFile(authPath, JSON.stringify({ "google": { type: "api_key", key: "fake-google-api-key" } }, null, 2));
  const runtime4 = await ModelRuntime.create({ allowModelNetwork: false, refreshOnCreate: false, authPath });
  try {
    const avail4 = await runtime4.getAvailable("google");
    const model = runtime4.getModel("google", avail4[0].id);
    const stream = runtime4.stream(model, {
      systemPrompt: "",
      messages: [{ role: "user", content: "hi" }],
    });
    for await (const ev of stream) {
      if (ev.type === "error") {
        console.log("  ERROR:", (ev.error.errorMessage ?? "").slice(0, 400));
      }
    }
  } catch (e) {
    console.log("  threw:", e instanceof Error ? e.message : String(e));
  }

  console.log("\n[isolation] auth.json 现状: see", authPath, "（隔离目录，不影响正式）");
}

void main();
