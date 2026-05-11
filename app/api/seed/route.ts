import { NextResponse } from "next/server";
import { saveChannels, saveReps, saveStores, saveUsers, saveTeams, getUsers } from "@/lib/data";
import { Channel, Rep, Store, User, Team } from "@/lib/types";
import bcrypt from "bcryptjs";

// Pre-extracted data from the Excel file
const RAW_CHANNELS = [
  "BLUE BOTTLE LIQUORS","BP","CALTEX","CANDYLICIOUS","CANNAFRICA",
  "CRAZY PLASTICS","ENGEN","EXEL","FOOD LOVERS","FOODZONE",
  "FORECOURT","FRUIT & VEG","INDEPENDENT","JACKS PAINT",
  "LIQUOR CITY","LIQUOR STORE","MICA","OK","OTHER","PHARMACY",
  "PICK N PAY","PRESIDENT HYPER","SASOL","SHELL","SHIELD",
  "SHOPRITE","SPAR","SUPERMARKET","SWEETS FROM HEAVEN",
  "TOBACCONIST","TOTAL","TOYS R US","ZENEX"
];

const RAW_REPS: Record<string, string> = {
  "GAU065": "Jennine Krishna",
  "GAU058": "Rufus Selolo",
  "GAU012": "Khethiwe Molekwa",
  "GAU036": "Jacqui Vanos",
  "GAU086": "Alex Tsonis",
  "GAU018": "David Dikolomela",
};

export async function POST() {
  try {
    // 1. Channels
    const channels: Channel[] = RAW_CHANNELS.map((name) => ({
      id: name.toLowerCase().replace(/[^a-z0-9]/g, "_"),
      name,
      frequency: "monthly" as const,
      duration: 30,
    }));
    await saveChannels(channels);

    // 2. Team — Roliezer Boseme's team
    const teamId = crypto.randomUUID();
    const team: Team = {
      id: teamId,
      name: "Gauteng Team",
      managerId: "",
      managerName: "Roliezer Boseme",
      managerEmail: "rolie@clippasales.com",
      managerCell: "",
      area: "Gauteng",
    };
    await saveTeams([team]);

    // 3. Reps — all assigned to Roliezer's team
    const reps: Rep[] = Object.entries(RAW_REPS).map(([code, name]) => ({
      id: crypto.randomUUID(),
      code,
      name,
      email: "",
      cell: "",
      homeAddress: "",
      homeGpsLat: "",
      homeGpsLng: "",
      teamId,
    }));
    await saveReps(reps);

    // 4. Super admins + team manager — always recreate
    const defaultPw = await bcrypt.hash("clippa2026", 10);
    const users: User[] = [
      {
        id: crypto.randomUUID(),
        name: "Carl Dos Santos",
        email: "carl@outerjoin.co.za",
        password: defaultPw,
        role: "superAdmin",
      },
      {
        id: crypto.randomUUID(),
        name: "Ago Vieira",
        email: "ago@clippasales.com",
        password: defaultPw,
        role: "superAdmin",
      },
      {
        id: crypto.randomUUID(),
        name: "Roliezer Boseme",
        email: "rolie@clippasales.com",
        password: defaultPw,
        role: "teamManager",
      },
    ];
    await saveUsers(users);
    // verify write
    const savedUsers = await getUsers();

    // 5. Stores — read from the bundled Excel
    let storeCount = 0;
    try {
      const XLSX = await import("xlsx");
      const fs = await import("fs");
      const path = await import("path");

      const excelPath = path.join(process.cwd(), "seed-data.xlsx");
      if (fs.existsSync(excelPath)) {
        const wb = XLSX.readFile(excelPath);
        const ws = wb.Sheets[wb.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json<Record<string, string | number>>(ws);
        const channelLookup = new Map(channels.map((c) => [c.name, c.id]));

        const stores: Store[] = rows
          .filter((r) => r["PLACE ID"] && r["PLACE NAME"])
          .map((row) => {
            const channelName = String(row["CHANNEL"] || "").trim();
            return {
              id: String(row["PLACE ID"]).trim(),
              placeId: String(row["PLACE ID"]).trim(),
              name: String(row["PLACE NAME"]).trim(),
              channelId: channelLookup.get(channelName) || "",
              repCode: String(row["REPRESENTATIVE ID"] || "").trim(),
              gpsLat: String(row["GPS LATITUDE"] || "").trim(),
              gpsLng: String(row["GPS LONGITUDE"] || "").trim(),
              monthlySales: Number(row["MONTHLY AVERAGE"] || 0),
              frequency: "monthly" as const,
              duration: 30,
              dayOfWeek: "",
              weekNumber: "",
            };
          });

        await saveStores(stores);
        storeCount = stores.length;
      }
    } catch (e) {
      console.error("Store seed error:", e);
    }

    return NextResponse.json({
      ok: true,
      seeded: {
        channels: channels.length,
        reps: reps.length,
        stores: storeCount,
        teams: 1,
        users: savedUsers.length,
      },
    });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
