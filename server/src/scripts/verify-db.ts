
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function verify() {
  console.log("🔍 Verifying database state...");

  const factions = await prisma.faction.count();
  console.log(`Factions: ${factions}`);

  const personas = await prisma.aIPersona.count();
  console.log(`AI Personas: ${personas}`);

  const users = await prisma.user.count();
  console.log(`Users: ${users}`);

  const missions = await prisma.mission.count();
  console.log(`Missions: ${missions}`);

  const servers = await prisma.gameServer.count();
  console.log(`Servers: ${servers}`);

  if (factions < 4) console.error("❌ Missing factions!");
  if (personas < 5) console.error("❌ Missing AI personas!"); // 3 leaders + GM + AIDA
  if (users < 1) console.error("❌ Missing test user!");
  if (missions < 2) console.error("❌ Missing initial missions!");

  await prisma.$disconnect();
}

verify().catch(console.error);
