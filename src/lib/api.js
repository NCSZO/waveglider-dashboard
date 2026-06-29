import { supabase } from './supabase.js'

const FALLBACK_HOURS = 7 * 24

function check(result) {
  if (result.error) throw new Error(result.error.message)
  return result.data
}

function fallbackSince() {
  return new Date(Date.now() - FALLBACK_HOURS * 3_600_000).toISOString()
}

export async function getLatestTelemetry() {
  const result = await supabase
    .from('telemetry')
    .select('*')
    .order('glider_timestamp', { ascending: false })
    .limit(1)
  check(result)
  return result.data?.[0] ?? null
}

// Uses a server-side RPC that decimates the older portion of the track while
// keeping full-resolution recent rows — this sidesteps the PostgREST "Max rows"
// project cap that would otherwise silently clamp .limit() calls.
export async function getTelemetryHistory(since = fallbackSince()) {
  const rows = check(await supabase
    .rpc('get_telemetry_track', {
      p_since:        since,
      p_recent_hours: 48,
      p_max_points:   900
    })
  )
  // RPC returns DESC so PostgREST's row cap keeps newest rows if the result is
  // larger than the project "Max rows" setting. Reverse here to restore ascending
  // order expected by the map and charts.
  return rows?.reverse() ?? []
}

export async function getBatteryHistory(since = fallbackSince()) {
  return check(await supabase
    .from('battery_status')
    .select('timestamp,battery_wh,solar_mw,output_mw,charge_mw')
    .gte('timestamp', since)
    .order('timestamp', { ascending: true })
    .limit(5000)
  )
}

// Stable waypoints: WP 1 (mission start) + WP 110-173 (station centroids + infra).
// WP 180+ survey shapes are in site_waypoints (see getSiteWaypoints).
export async function getWaypoints() {
  return check(await supabase
    .from('waypoints')
    .select('wp_number,name,latitude,longitude,status')
    .eq('visible', true)
    .order('wp_number', { ascending: true })
  )
}

// Per-station survey waypoints (slots 180+), keyed by site name.
// The frontend merges the active site's rows into the waypoints array,
// mapping slot → wp_number so the rest of the app needs no changes.
export async function getSiteWaypoints() {
  return check(await supabase
    .from('site_waypoints')
    .select('site,slot,name,latitude,longitude')
    .eq('visible', true)
  )
}

export async function getActiveMission() {
  const result = await supabase
    .from('missions')
    .select('name,status,started_at,vehicle')
    .is('ended_at', null)
    .order('started_at', { ascending: false })
    .limit(1)
  if (result.error?.code === 'PGRST116') return null
  check(result)
  return result.data?.[0] ?? null
}
