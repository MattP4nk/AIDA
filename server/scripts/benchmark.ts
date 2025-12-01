
import { config } from "../src/config/environment";

const BASE_URL = `http://localhost:${config.PORT}/api`;
const TEST_USER = {
  username: "benchmark_user_" + Math.floor(Math.random() * 10000),
  password: "Password123!",
  email: `bench_${Math.floor(Math.random() * 10000)}@example.com`
};

async function benchmark() {
  console.log("🚀 Starting Performance Benchmark...");
  console.log(`Target: ${BASE_URL}`);

  // 1. Register/Login
  let token = "";
  try {
    console.log(`\n👤 Creating test user: ${TEST_USER.username}...`);
    const registerRes = await fetch(`${BASE_URL}/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(TEST_USER)
    });
    
    const registerData = await registerRes.json();
    
    if (!registerRes.ok) {
        // If user exists, try login
        console.log("User might exist, trying login...");
        const loginRes = await fetch(`${BASE_URL}/auth/login`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ username: TEST_USER.username, password: TEST_USER.password })
        });
        const loginData = await loginRes.json();
        if (!loginRes.ok) throw new Error(`Login failed: ${JSON.stringify(loginData)}`);
        token = loginData.token;
    } else {
        token = registerData.token;
    }
    console.log("✅ Authenticated");
  } catch (error) {
    console.error("❌ Auth failed:", error);
    process.exit(1);
  }

  // 2. Define commands to test
  const commands = [
    { name: "help", cmd: "help" },
    { name: "ls", cmd: "ls" },
    { name: "status", cmd: "status" }, // Assuming status exists or similar
    { name: "scan", cmd: "scan" },
    { name: "invalid", cmd: "invalid_command" }
  ];

  const results: Record<string, number[]> = {};
  const ITERATIONS = 10;

  console.log(`\n⚡ Running ${ITERATIONS} iterations per command...`);

  for (const { name, cmd } of commands) {
    results[name] = [];
    process.stdout.write(`Testing '${name}' `);
    
    for (let i = 0; i < ITERATIONS; i++) {
      const start = performance.now();
      
      try {
        const res = await fetch(`${BASE_URL}/command/execute`, {
          method: "POST",
          headers: { 
            "Content-Type": "application/json",
            "Authorization": `Bearer ${token}`
          },
          body: JSON.stringify({ command: cmd })
        });
        
        await res.json();
        const end = performance.now();
        results[name].push(end - start);
        process.stdout.write(".");
      } catch (e) {
        process.stdout.write("x");
        console.error(e);
      }
    }
    console.log(" Done");
  }

  // 3. Report
  console.log("\n📊 Benchmark Results (Latency in ms):");
  console.log("--------------------------------------------------");
  console.log("| Command |   Avg |   Min |   Max |   P95 |");
  console.log("--------------------------------------------------");

  for (const [name, times] of Object.entries(results)) {
    if (times.length === 0) continue;
    
    const sorted = times.sort((a, b) => a - b);
    const avg = times.reduce((a, b) => a + b, 0) / times.length;
    const min = sorted[0];
    const max = sorted[sorted.length - 1];
    const p95 = sorted[Math.floor(times.length * 0.95)];

    console.log(
      `| ${name.padEnd(7)} | ${avg.toFixed(1).padStart(5)} | ${min.toFixed(1).padStart(5)} | ${max.toFixed(1).padStart(5)} | ${p95.toFixed(1).padStart(5)} |`
    );
  }
  console.log("--------------------------------------------------");
}

benchmark();
