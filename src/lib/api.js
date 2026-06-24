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

export async function getTelemetryHistory(since = fallbackSince()) {
  return check(await supabase
    .from('telemetry')
    .select('glider_timestamp,latitude,longitude,heading,speed_over_ground_kts,target_waypoint,surface_temp_c')
    .gte('glider_timestamp', since)
    .order('glider_timestamp', { ascending: true })
    .limit(5000)
  )
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

export async function getWaypoints() {
  return check(await supabase
    .from('waypoints')
    .select('wp_number,name,latitude,longitude,status')
    .eq('visible', true)
    .order('wp_number', { ascending: true })
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
