// One-off demo-data seeder for the customer chart + analytics feature.
// Run with: npx tsx prisma/seed-chart-demo.ts
// Targets staff-a@example.com in the LOCAL dev DB only. Safe to re-run -
// it clears out its own previously-seeded rows (by a marker email domain)
// before re-inserting, so it won't accumulate duplicates across runs.
export {};

const DEMO_EMAIL_DOMAIN = "demo-chart.example.com";

interface DemoVisit {
  monthsAgo: number;
  amount: number;
  concernNames: string[];
  concernDetail?: string;
  customerImpression?: string;
  staffComment?: string;
  nextVisitMemo?: string;
}

interface DemoCustomer {
  name: string;
  phone: string;
  sourceName: string;
  visits: DemoVisit[]; // first entry (largest monthsAgo) is treated as the first visit
}

const CONCERN_NAMES = ["便秘", "ぽっこりお腹", "お腹の張り", "ガス", "睡眠", "冷え", "肌", "ストレス"];
const SOURCE_NAMES = ["Threads", "Instagram", "Google", "紹介", "公式LINE"];

const DEMO_CUSTOMERS: DemoCustomer[] = [
  {
    name: "田中花子",
    phone: "090-1111-2222",
    sourceName: "Instagram",
    visits: [
      { monthsAgo: 5, amount: 9900, concernNames: ["便秘", "お腹の張り"], customerImpression: "スッキリした感じがして良かったです", staffComment: "初回、緊張されていた様子" },
      { monthsAgo: 3, amount: 9900, concernNames: ["便秘"], customerImpression: "前回より楽になりました" },
      { monthsAgo: 0, amount: 9900, concernNames: ["便秘", "睡眠"], customerImpression: "よく眠れるようになってきた気がします", nextVisitMemo: "睡眠の質を次回ヒアリング" },
    ],
  },
  {
    name: "佐藤美咲",
    phone: "090-2222-3333",
    sourceName: "Threads",
    visits: [
      { monthsAgo: 5, amount: 5000, concernNames: ["ぽっこりお腹"], staffComment: "モニター価格で対応" },
      { monthsAgo: 2, amount: 9900, concernNames: ["ぽっこりお腹", "冷え"], customerImpression: "お腹周りがスッキリしてきました" },
    ],
  },
  {
    name: "鈴木愛",
    phone: "090-3333-4444",
    sourceName: "紹介",
    visits: [
      { monthsAgo: 4, amount: 9900, concernNames: ["ガス", "お腹の張り"] },
      { monthsAgo: 1, amount: 9900, concernNames: ["ガス"], customerImpression: "ガスが減った気がします" },
      { monthsAgo: 0, amount: 9900, concernNames: ["ガス", "ストレス"], staffComment: "ストレス由来の可能性、次回もヒアリング継続" },
    ],
  },
  {
    name: "高橋optional".replace("optional", "由美"),
    phone: "090-4444-5555",
    sourceName: "公式LINE",
    visits: [{ monthsAgo: 4, amount: 9900, concernNames: ["肌"], customerImpression: "肌の調子が良くなってきました" }],
  },
  {
    name: "伊藤結衣",
    phone: "090-5555-6666",
    sourceName: "Google",
    visits: [
      { monthsAgo: 3, amount: 9900, concernNames: ["冷え", "睡眠"] },
      { monthsAgo: 0, amount: 9900, concernNames: ["冷え"], customerImpression: "冷えが改善してきました" },
    ],
  },
  {
    name: "渡辺さくら",
    phone: "090-6666-7777",
    sourceName: "Instagram",
    visits: [{ monthsAgo: 2, amount: 9900, concernNames: ["便秘", "肌"], nextVisitMemo: "食生活について次回ヒアリング" }],
  },
  {
    name: "山本花",
    phone: "090-7777-8888",
    sourceName: "Threads",
    visits: [
      { monthsAgo: 2, amount: 5000, concernNames: ["ストレス"], staffComment: "モニター価格" },
      { monthsAgo: 0, amount: 9900, concernNames: ["ストレス", "睡眠"], customerImpression: "気持ちが楽になりました" },
    ],
  },
  {
    name: "中村optional".replace("optional", "友梨"),
    phone: "090-8888-9999",
    sourceName: "紹介",
    visits: [{ monthsAgo: 1, amount: 9900, concernNames: ["お腹の張り"] }],
  },
  {
    name: "小林彩",
    phone: "090-9999-0000",
    sourceName: "Google",
    visits: [{ monthsAgo: 1, amount: 9900, concernNames: ["ぽっこりお腹", "ガス"], customerImpression: "お腹周りが軽くなった感じです" }],
  },
  {
    name: "加藤美穂",
    phone: "090-0000-1111",
    sourceName: "公式LINE",
    visits: [{ monthsAgo: 0, amount: 9900, concernNames: ["冷え", "肌"], nextVisitMemo: "保湿ケアについて次回案内" }],
  },
  {
    name: "松本香織",
    phone: "090-1212-3434",
    sourceName: "Instagram",
    visits: [{ monthsAgo: 0, amount: 9900, concernNames: ["便秘"] }],
  },
];

function monthsAgoToDate(monthsAgo: number, dayOfMonth: number): Date {
  const now = new Date();
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - monthsAgo, dayOfMonth, 0, 0, 0));
  return d;
}

async function main() {
  const { config: loadEnv } = await import("dotenv");
  loadEnv({ path: ".env.local" });
  loadEnv({ path: ".env" });

  if (process.env.NODE_ENV === "production" || process.env.VERCEL_ENV === "production") {
    console.error("Refusing to run demo-chart seed against a production environment.");
    process.exit(1);
  }

  const { prisma } = await import("../src/lib/db/prisma");
  const { normalizePhoneDigits } = await import("../src/lib/customers/normalize");

  const staff = await prisma.staff.findUniqueOrThrow({ where: { loginEmail: "staff-a@example.com" } });

  // Clean up any previous run's rows (marker: demo email domain) before re-seeding.
  const previousCustomers = await prisma.customer.findMany({
    where: { ownerStaffId: staff.id, email: { endsWith: `@${DEMO_EMAIL_DOMAIN}` } },
    select: { id: true },
  });
  const previousIds = previousCustomers.map((c) => c.id);
  if (previousIds.length > 0) {
    await prisma.visitRecord.deleteMany({ where: { customerId: { in: previousIds } } });
    await prisma.customer.deleteMany({ where: { id: { in: previousIds } } });
  }

  // Upsert master lists (idempotent - unique on [staffId, name]).
  const concernByName = new Map<string, string>();
  for (const [i, name] of CONCERN_NAMES.entries()) {
    const row = await prisma.concernMaster.upsert({
      where: { staffId_name: { staffId: staff.id, name } },
      update: {},
      create: { staffId: staff.id, name, sortOrder: i, active: true },
    });
    concernByName.set(name, row.id);
  }

  const sourceByName = new Map<string, string>();
  for (const [i, name] of SOURCE_NAMES.entries()) {
    const row = await prisma.acquisitionSourceMaster.upsert({
      where: { staffId_name: { staffId: staff.id, name } },
      update: {},
      create: { staffId: staff.id, name, sortOrder: i, active: true },
    });
    sourceByName.set(name, row.id);
  }

  let customerCount = 0;
  let visitCount = 0;

  for (const [ci, demoCustomer] of DEMO_CUSTOMERS.entries()) {
    const email = `demo-customer-${ci + 1}@${DEMO_EMAIL_DOMAIN}`;
    const sortedVisits = [...demoCustomer.visits].sort((a, b) => b.monthsAgo - a.monthsAgo);
    const firstVisit = sortedVisits[0];
    const firstVisitDate = monthsAgoToDate(firstVisit.monthsAgo, 10 + (ci % 15));
    const sourceId = sourceByName.get(demoCustomer.sourceName)!;

    const customer = await prisma.customer.create({
      data: {
        ownerStaffId: staff.id,
        name: demoCustomer.name,
        email,
        phone: demoCustomer.phone,
        phoneDigits: normalizePhoneDigits(demoCustomer.phone),
        firstVisitDate,
        firstVisitAcquisitionSourceId: sourceId,
      },
    });
    customerCount += 1;

    for (const [vi, visit] of sortedVisits.entries()) {
      const visitDate = vi === 0 ? firstVisitDate : monthsAgoToDate(visit.monthsAgo, 10 + (ci % 15) + vi);
      await prisma.visitRecord.create({
        data: {
          staffId: staff.id,
          customerId: customer.id,
          visitDate,
          amount: visit.amount,
          concernDetail: visit.concernDetail,
          customerImpression: visit.customerImpression,
          staffComment: visit.staffComment,
          nextVisitMemo: visit.nextVisitMemo,
          concerns: { connect: visit.concernNames.map((name) => ({ id: concernByName.get(name)! })) },
        },
      });
      visitCount += 1;
    }
  }

  console.log(`Seeded demo chart data for ${staff.displayName} (${staff.loginEmail}):`);
  console.log(`  ${CONCERN_NAMES.length} concerns, ${SOURCE_NAMES.length} acquisition sources`);
  console.log(`  ${customerCount} customers, ${visitCount} visit records (spread across the last 6 months)`);
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
