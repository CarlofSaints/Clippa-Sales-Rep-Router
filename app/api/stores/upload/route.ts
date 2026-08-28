import { NextRequest, NextResponse } from "next/server";
import { getStores, saveStores, getChannels, saveChannels, getReps, saveReps, getStoreOverrides, getAllocationSettings } from "@/lib/data";
import { overriddenStoreIds } from "@/lib/channelDefaults";
import { uploadScope } from "@/lib/uploadScope";
import { Store, Channel, Rep } from "@/lib/types";
import { getSession } from "@/lib/auth";
import { logActivity } from "@/lib/activityLog";
import * as XLSX from "xlsx";

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get("file") as File | null;
    if (!file) return NextResponse.json({ error: "No file" }, { status: 400 });

    /**
     * "merge" (the default, and what this route has always done) adds and
     * updates, and never takes anything away. So a rep's store list is the union
     * of every file ever loaded for them, which is how a rep ends up carrying
     * stores nobody remembers loading.
     *
     * "replace" makes the file authoritative FOR THE REPS IT NAMES: a store
     * currently carrying one of those rep codes, that the file does not list, is
     * un-assigned. Deliberately scoped to the rep codes in the file, so loading
     * one rep's round can never touch another's.
     */
    const replaceAllocation = String(formData.get("mode") || "merge") === "replace";
    /** Report what would change and save nothing. Always run this first. */
    const dryRun = String(formData.get("dryRun") || "") === "true";

    const buffer = Buffer.from(await file.arrayBuffer());
    const wb = XLSX.read(buffer, { type: "buffer" });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json<Record<string, string | number>>(ws);

    // Load existing data
    const existingChannels = await getChannels();
    const existingReps = await getReps();
    const existingStores = await getStores();
    // IMS as the authority makes rep code read-only to an upload. A NEW store
    // still takes the rep the file gives it, because IMS has no opinion on a
    // store this app has never seen.
    const allocation = await getAllocationSettings();
    const repWritable = allocation.source !== "ims";
    const channelMap = new Map(existingChannels.map((c) => [c.name, c]));
    const repMap = new Map(existingReps.map((r) => [r.code, r]));

    // Index existing stores by placeId for merge
    const storeMap = new Map(existingStores.map((s) => [s.placeId, s]));
    const pinnedStoreIds = overriddenStoreIds(await getStoreOverrides());
    let newCount = 0;
    let updatedCount = 0;

    // Helper: try multiple header names, return first match (case-insensitive, trimmed)
    const col = (row: Record<string, string | number>, ...keys: string[]) => {
      const trimmedEntries = Object.entries(row).map(([k, v]) => [k.trim(), v] as const);
      for (const k of keys) {
        const kLower = k.toLowerCase();
        const entry = trimmedEntries.find(([tk]) => tk.toLowerCase() === kLower);
        if (entry !== undefined && entry[1] !== undefined && entry[1] !== "") {
          return String(entry[1]).trim();
        }
      }
      return "";
    };

    // Detect file headers for diagnostics
    const fileHeaders = rows.length > 0 ? Object.keys(rows[0]).map((h) => h.trim()) : [];
    let skippedRows = 0;
    // Rows the file left blank in a column it DOES carry. Those keep whatever the
    // store already had, and the counts say so rather than leaving it a mystery.
    let blankChannelCells = 0;
    let blankGpsCells = 0;
    let blankRepCells = 0;
    let repCellsIgnored = 0;
    // What the file actually claims, gathered as the rows are read. Replace mode
    // needs both: the reps it is speaking for, and the stores it lists for them.
    const repCodesInFile = new Set<string>();
    const placeIdsInFile = new Set<string>();

    // Which fields this file is allowed to touch. Presence of the COLUMN decides
    // scope: absent means leave the field alone. See lib/uploadScope.ts for why
    // this is not inline any more.
    const { hasSales: hasSalesColumn, hasChannel: hasChannelColumn, hasGps: hasGpsColumns, hasRep: hasRepColumn } =
      uploadScope(fileHeaders);

    // Detect format: Repsly Places export has "ID" + "Name" + "Representative ID" columns
    // (Tags column is optional — some Repsly exports omit it)
    const hasRepslyFormat = fileHeaders.some((h) => h === "ID") &&
      fileHeaders.some((h) => h === "Name") &&
      fileHeaders.some((h) => h === "Representative ID");

    for (const row of rows) {
      let placeId: string, storeName: string, repCode: string, repName: string;
      let channelName: string, lat: string, lng: string, region: string;
      let rawSales: string;

      if (hasRepslyFormat) {
        // Repsly Places export format
        placeId = col(row, "ID");
        storeName = col(row, "Name");
        repCode = col(row, "Representative ID");
        repName = col(row, "Representative name");
        lat = col(row, "Gps latitude");
        lng = col(row, "Gps longitude");
        region = col(row, "State", "Territory");
        rawSales = "";
        // Channel from Tags: "INDEPENDENT','GAUTENG" → first tag = channel
        const tags = col(row, "Tags");
        const tagParts = tags.split(/[',]+/).map((t) => t.trim()).filter(Boolean);
        channelName = tagParts[0] || "";
      } else {
        // Original format
        placeId = col(row, "PLACE ID", "STORE ID", "Store ID", "Place ID");
        storeName = col(row, "PLACE NAME", "STORE NAME", "Store Name", "Place Name");
        repCode = col(row, "REPRESENTATIVE ID", "REP CODE", "Rep Code", "Representative ID");
        repName = col(row, "REPRESENTATIVE NAME", "REP NAME", "Rep Name", "Representative Name");
        channelName = col(row, "CHANNEL", "Channel", "CHANNEL NAME", "Channel Name");
        lat = col(row, "GPS LATITUDE", "Gps latitude", "Gps Latitude", "GPS_LATITUDE", "Latitude");
        lng = col(row, "GPS LONGITUDE", "Gps longitude", "Gps Longitude", "GPS_LONGITUDE", "Longitude");
        rawSales = col(row, "MONTHLY AVERAGE", "VALUE", "Value", "Monthly Average", "Sales");
        region = col(row, "REGION", "Region", "PROVINCE", "Province", "AREA", "Area");
      }

      const sales = Number((rawSales || "").replace(/[^0-9.\-]/g, "") || 0);

      if (!placeId || !storeName) { skippedRows++; continue; }

      // Recorded for every valid row, whatever the mode, so a dry run reports the
      // same scope the real run would act on. A skipped row claims nothing.
      placeIdsInFile.add(placeId.trim().toUpperCase());
      if (repCode) repCodesInFile.add(repCode.trim().toUpperCase());

      // Auto-create channel
      if (channelName && !channelMap.has(channelName)) {
        const ch: Channel = {
          id: channelName.toLowerCase().replace(/[^a-z0-9]/g, "_"),
          name: channelName,
          frequency: "monthly",
          duration: 30,
        };
        channelMap.set(channelName, ch);
      }

      // Auto-create rep
      if (repCode && !repMap.has(repCode)) {
        const r: Rep = {
          id: crypto.randomUUID(),
          code: repCode,
          name: repName,
          email: "",
          cell: "",
          homeAddress: "",
          homeGpsLat: "",
          homeGpsLng: "",
          teamId: "",
        };
        repMap.set(repCode, r);
      }

      const channel = channelMap.get(channelName);
      const channelId = channel?.id || "";

      if (storeMap.has(placeId)) {
        // Update existing store
        const existing = storeMap.get(placeId)!;

        // A store that moves to a different channel takes that channel's

        // defaults with it, unless a manager has pinned it with an override.

        // A channel is only written when the file actually carries the column AND
        // the name resolved to a real channel. An unmatched name is reported, not
        // written as a blank — the alternative silently unclassifies the store and
        // drops it out of every channel-driven report.
        const writeChannel = hasChannelColumn && !!channel;
        const movedChannel = writeChannel && existing.channelId !== channelId;

        existing.name = storeName;
        if (writeChannel) existing.channelId = channelId;
        if (hasChannelColumn && !channelName) blankChannelCells++;

        if (movedChannel && channel && !pinnedStoreIds.has(existing.id)) {

          existing.frequency = channel.frequency;

          existing.duration = channel.duration;

        }
        // Guarded like its three siblings above. A blank cell in a column that
        // IS present is "no value here", not "belongs to nobody".
        //
        // ⚠️ And guarded again by the allocation source. When IMS is the
        // authority, a Places export must not be able to take a store back off
        // the rep IMS says owns it. Without this half, an IMS allocation
        // survives exactly until somebody loads a spreadsheet.
        if (hasRepColumn && repCode) {
          if (repWritable) existing.repCode = repCode;
          else repCellsIgnored++;
        } else if (hasRepColumn) blankRepCells++;
        // Coordinates move as a pair, and only when the file carries them.
        if (hasGpsColumns) {
          // A blank pair in a file that HAS the columns is still "no value here",
          // so it must not erase coordinates the store already carries.
          if (lat && lng) {
            existing.gpsLat = lat;
            existing.gpsLng = lng;
          } else {
            blankGpsCells++;
          }
        }
        if (hasSalesColumn) existing.monthlySales = sales;
        if (region) existing.region = region;
        updatedCount++;
      } else {
        // Add new store
        storeMap.set(placeId, {
          id: placeId,
          placeId,
          name: storeName,
          channelId,
          repCode,
          gpsLat: lat,
          gpsLng: lng,
          monthlySales: sales,
          // Inherit the channel's defaults. These used to be hardcoded to
          // monthly/30, so every uploaded store ignored its channel's
          // settings from the moment it was created.
          frequency: channel?.frequency ?? "monthly",
          duration: channel?.duration ?? 30,
          dayOfWeek: "",
          weekNumber: "",
          ...(region ? { region } : {}),
        });
        newCount++;
      }
    }

    // ── Replace mode: un-assign what the file left out ──────────────────
    //
    // Un-assigned, not deleted. The store keeps its name, coordinates, channel
    // and sales, so nothing is lost and the decision is reversible by loading a
    // file that claims it again. Data Health lists them under "Stores with no
    // rep code at all", so they surface rather than quietly ceasing to exist.
    const unassigned: { placeId: string; name: string; repCode: string }[] = [];
    if (replaceAllocation) {
      if (!hasRepColumn) {
        return NextResponse.json(
          { error: "Replace mode needs a rep column. This file has none, so there is no way to tell which rep's list it is replacing." },
          { status: 400 }
        );
      }
      for (const store of storeMap.values()) {
        const rc = (store.repCode || "").trim().toUpperCase();
        if (!rc || !repCodesInFile.has(rc)) continue;
        if (placeIdsInFile.has((store.placeId || "").trim().toUpperCase())) continue;
        unassigned.push({ placeId: store.placeId, name: store.name, repCode: store.repCode });
        if (!dryRun) store.repCode = "";
      }
      unassigned.sort((a, b) => a.repCode.localeCompare(b.repCode) || a.name.localeCompare(b.name));
    }

    if (dryRun) {
      return NextResponse.json({
        ok: true,
        dryRun: true,
        added: newCount,
        updated: updatedCount,
        total: storeMap.size,
        rowsInFile: rows.length,
        skippedRows,
        fileHeaders,
        scope: { channel: hasChannelColumn, gps: hasGpsColumns, sales: hasSalesColumn, rep: hasRepColumn },
        blankChannelCells,
        blankGpsCells,
        blankRepCells,
        replaceAllocation,
        repCodesInFile: Array.from(repCodesInFile).sort(),
        unassignedCount: unassigned.length,
        unassigned: unassigned.slice(0, 200),
      });
    }

    await saveChannels(Array.from(channelMap.values()));
    await saveReps(Array.from(repMap.values()));
    await saveStores(Array.from(storeMap.values()));

    const session = await getSession();
    logActivity({
      action: "Uploaded stores",
      actor: session?.email || "unknown",
      actorName: session?.name || "Unknown",
      summary: `Uploaded ${file.name}: ${newCount} added, ${updatedCount} updated${replaceAllocation ? `, ${unassigned.length} un-assigned` : ""} (${storeMap.size} total)`,
      details: replaceAllocation
        ? `Replace mode for ${Array.from(repCodesInFile).sort().join(", ")}. Un-assigned: ${unassigned.map((u) => u.placeId).join(", ") || "none"}`
        : undefined,
    });

    return NextResponse.json({
      ok: true,
      added: newCount,
      updated: updatedCount,
      total: storeMap.size,
      channels: channelMap.size,
      reps: repMap.size,
      rowsInFile: rows.length,
      skippedRows,
      fileHeaders,
      // What the file was allowed to touch, and what it left alone. Without this
      // a sheet that silently skipped a column looks identical to one that wrote it.
      scope: { channel: hasChannelColumn, gps: hasGpsColumns, sales: hasSalesColumn, rep: hasRepColumn },
      blankChannelCells,
      blankGpsCells,
      blankRepCells,
      repCellsIgnored,
      allocationSource: allocation.source,
      replaceAllocation,
      repCodesInFile: Array.from(repCodesInFile).sort(),
      unassignedCount: unassigned.length,
      unassigned: unassigned.slice(0, 200),
    });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
