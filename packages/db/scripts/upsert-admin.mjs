import bcrypt from "bcryptjs";
import { prisma } from "../dist/src/index.js";

const email = "auz@garbagepailpals.com";
const passwordHash = await bcrypt.hash("garbagepailpals11", 12);

await prisma.user.upsert({
  where: { email },
  update: {
    name: "Auz Admin",
    phone: "+15035550100",
    role: "ADMIN",
    authProviderId: "local-auz",
    passwordHash
  },
  create: {
    email,
    name: "Auz Admin",
    phone: "+15035550100",
    role: "ADMIN",
    authProviderId: "local-auz",
    passwordHash
  }
});

const user = await prisma.user.findUnique({
  where: { email },
  select: {
    email: true,
    role: true,
    name: true,
    authProviderId: true
  }
});

console.log(JSON.stringify(user));
await prisma.$disconnect();
