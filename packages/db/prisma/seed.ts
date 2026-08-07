import bcrypt from "bcryptjs";
import { addDays, addHours, startOfDay } from "date-fns";
import { prisma } from "../src";

async function seed() {
  await prisma.$transaction([
    prisma.auditLog.deleteMany(),
    prisma.webhookEvent.deleteMany(),
    prisma.serviceJob.deleteMany(),
    prisma.serviceHold.deleteMany(),
    prisma.subscription.deleteMany(),
    prisma.entitlement.deleteMany(),
    prisma.serviceSchedule.deleteMany(),
    prisma.serviceAddress.deleteMany(),
    prisma.refreshToken.deleteMany(),
    prisma.user.deleteMany(),
    prisma.plan.deleteMany(),
    prisma.serviceArea.deleteMany(),
    prisma.holidayCalendar.deleteMany()
  ]);

  const passwordHash = await bcrypt.hash("Password123!", 12);

  const [admin, operator, customer1, customer2] = await Promise.all([
    prisma.user.create({
      data: {
        email: "admin@garbagepailpals.com",
        name: "Admin User",
        phone: "+15035550100",
        role: "ADMIN",
        authProviderId: "local-admin",
        passwordHash
      }
    }),
    prisma.user.create({
      data: {
        email: "operator@garbagepailpals.com",
        name: "Opal Operator",
        phone: "+15035550101",
        role: "OPERATOR",
        authProviderId: "local-operator",
        passwordHash
      }
    }),
    prisma.user.create({
      data: {
        email: "chris@garbagepailpals.com",
        name: "Chris Curb",
        phone: "+15035550102",
        role: "CUSTOMER",
        authProviderId: "local-chris",
        passwordHash
      }
    }),
    prisma.user.create({
      data: {
        email: "sam@garbagepailpals.com",
        name: "Sam Schedule",
        phone: "+15035550103",
        role: "CUSTOMER",
        authProviderId: "local-sam",
        passwordHash
      }
    })
  ]);

  const [starterPlan, plusPlan, annualPlan] = await Promise.all([
    prisma.plan.create({
      data: {
        code: "starter-monthly",
        name: "Starter",
        description: "One can, weekly curb-out and curb-in.",
        priceCents: 1900,
        interval: "MONTHLY",
        stripePriceId: "price_starter_monthly",
        paypalPlanId: "P-STARTER-M",
        revenueCatEntitlementId: "pro_service"
      }
    }),
    prisma.plan.create({
      data: {
        code: "plus-monthly",
        name: "Plus",
        description: "Up to two cans with priority support.",
        priceCents: 2900,
        interval: "MONTHLY",
        stripePriceId: "price_plus_monthly",
        paypalPlanId: "P-PLUS-M",
        revenueCatEntitlementId: "pro_service"
      }
    }),
    prisma.plan.create({
      data: {
        code: "annual-save",
        name: "Annual Save",
        description: "Best value annual prepay plan.",
        priceCents: 29900,
        interval: "YEARLY",
        stripePriceId: "price_annual",
        paypalPlanId: "P-ANNUAL",
        revenueCatEntitlementId: "pro_service"
      }
    })
  ]);

  await prisma.serviceArea.createMany({
    data: [
      { postalCode: "97201", isActive: true },
      { postalCode: "97202", isActive: true },
      { postalCode: "97203", isActive: true }
    ]
  });

  await prisma.holidayCalendar.createMany({
    data: [
      {
        region: "US-OR",
        municipality: "Portland",
        date: new Date("2026-09-07T00:00:00.000Z"),
        shiftDays: 1
      }
    ]
  });

  const [address1, address2] = await Promise.all([
    prisma.serviceAddress.create({
      data: {
        userId: customer1.id,
        line1: "123 Maple St",
        city: "Portland",
        state: "OR",
        postalCode: "97201",
        lat: 45.5111,
        lng: -122.6765,
        timezone: "America/Los_Angeles",
        accessNotes: "Can is behind side gate, code 4417.",
        gateCode: "4417",
        canCount: 1,
        isActive: true
      }
    }),
    prisma.serviceAddress.create({
      data: {
        userId: customer2.id,
        line1: "789 Alder Ave",
        line2: "Unit B",
        city: "Portland",
        state: "OR",
        postalCode: "97202",
        lat: 45.489,
        lng: -122.654,
        timezone: "America/Los_Angeles",
        accessNotes: "Please close wooden gate after service.",
        canCount: 2,
        isActive: true
      }
    })
  ]);

  await Promise.all([
    prisma.serviceSchedule.create({
      data: {
        serviceAddressId: address1.id,
        pickupDayOfWeek: 2,
        cadence: "WEEKLY",
        curbOutOffsetHours: -12,
        curbInOffsetHours: 8
      }
    }),
    prisma.serviceSchedule.create({
      data: {
        serviceAddressId: address2.id,
        pickupDayOfWeek: 4,
        cadence: "BIWEEKLY",
        biweeklyAnchorDate: new Date("2026-08-06T00:00:00.000Z"),
        curbOutOffsetHours: -14,
        curbInOffsetHours: 9
      }
    })
  ]);

  const now = new Date();
  const nextMonth = addDays(now, 30);

  const [sub1, sub2] = await Promise.all([
    prisma.subscription.create({
      data: {
        userId: customer1.id,
        serviceAddressId: address1.id,
        planId: starterPlan.id,
        status: "ACTIVE",
        currentPeriodStart: now,
        currentPeriodEnd: nextMonth,
        cancelAtPeriodEnd: false
      }
    }),
    prisma.subscription.create({
      data: {
        userId: customer2.id,
        serviceAddressId: address2.id,
        planId: plusPlan.id,
        status: "ACTIVE",
        currentPeriodStart: now,
        currentPeriodEnd: nextMonth,
        cancelAtPeriodEnd: false
      }
    })
  ]);

  await prisma.entitlement.createMany({
    data: [
      {
        userId: customer1.id,
        source: "STRIPE",
        externalSubscriptionId: "sub_chris_001",
        status: "ACTIVE",
        expiresAt: nextMonth,
        rawPayload: { provider: "stripe", plan: starterPlan.code }
      },
      {
        userId: customer2.id,
        source: "PAYPAL",
        externalSubscriptionId: "I-SAM001",
        status: "ACTIVE",
        expiresAt: nextMonth,
        rawPayload: { provider: "paypal", plan: plusPlan.code }
      }
    ]
  });

  const monthJobs: Array<{
    serviceAddressId: string;
    subscriptionId: string;
    scheduledDate: Date;
    type: "CURB_OUT" | "CURB_IN";
    status: "SCHEDULED";
    assignedOperatorId: string;
  }> = [];

  for (let dayOffset = 0; dayOffset < 30; dayOffset += 1) {
    const date = addDays(startOfDay(now), dayOffset);

    if (date.getDay() === 2) {
      monthJobs.push({
        serviceAddressId: address1.id,
        subscriptionId: sub1.id,
        scheduledDate: addHours(date, 18),
        type: "CURB_OUT",
        status: "SCHEDULED",
        assignedOperatorId: operator.id
      });
      monthJobs.push({
        serviceAddressId: address1.id,
        subscriptionId: sub1.id,
        scheduledDate: addHours(date, 21),
        type: "CURB_IN",
        status: "SCHEDULED",
        assignedOperatorId: operator.id
      });
    }

    const isBiweeklyThursday = date.getDay() === 4 && Math.floor(dayOffset / 7) % 2 === 0;
    if (isBiweeklyThursday) {
      monthJobs.push({
        serviceAddressId: address2.id,
        subscriptionId: sub2.id,
        scheduledDate: addHours(date, 17),
        type: "CURB_OUT",
        status: "SCHEDULED",
        assignedOperatorId: operator.id
      });
      monthJobs.push({
        serviceAddressId: address2.id,
        subscriptionId: sub2.id,
        scheduledDate: addHours(date, 21),
        type: "CURB_IN",
        status: "SCHEDULED",
        assignedOperatorId: operator.id
      });
    }
  }

  if (monthJobs.length > 0) {
    await prisma.serviceJob.createMany({ data: monthJobs });
  }

  await prisma.auditLog.create({
    data: {
      actorUserId: admin.id,
      action: "SEED_BOOTSTRAP",
      entityType: "SYSTEM",
      entityId: "phase-1",
      metadata: { seededAt: new Date().toISOString(), planCount: 3 }
    }
  });
}

seed()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error: unknown) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
