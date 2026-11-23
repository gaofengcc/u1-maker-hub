import { NextResponse, type NextRequest } from "next/server";
import { listFavorites, mergeMakerWorld, readSyncState, writeSyncState, type SyncState } from "@/lib/favorites.ts";
import { MakerWorldError, myMakerWorldSaves } from "@/lib/makerworld.ts";

const MIN_INTERVAL_MS = 2 * 60_000;

// One sync at a time, shared by every tab that asks.
let running: Promise<SyncState> | null = null;

async function sync(): Promise<SyncState> {
  try {
    const { likes, collects } = await myMakerWorldSaves();
    mergeMakerWorld(likes, collects);
    const state = { syncedAt: new Date().toISOString(), liked: likes.length, collected: collects.length, error: null, code: null };
    writeSyncState(state);
    return state;
  } catch (err) {
    // A failed sync keeps the saved list as it was.
    const state = {
      ...readSyncState(),
      error: err instanceof Error ? err.message : String(err),
      code: err instanceof MakerWorldError ? err.code : null,
    };
    writeSyncState(state);
    return state;
  }
}

/**
 * Brings in the models liked or collected on MakerWorld. Pages call it when they open; it runs at
 * most every 2 minutes unless ?force=1 (the Sync now button). Responds with the saved list and the sync state.
 */
export async function POST(req: NextRequest) {
  const force = req.nextUrl.searchParams.get("force") === "1";
  const last = readSyncState();
  const fresh = last.syncedAt && Date.now() - new Date(last.syncedAt).getTime() < MIN_INTERVAL_MS && !last.error;
  let state = last;
  if (force || !fresh) {
    running ??= sync().finally(() => (running = null));
    state = await running;
  }
  return NextResponse.json({ favorites: listFavorites(), sync: state });
}

export async function GET() {
  return NextResponse.json(readSyncState());
}
