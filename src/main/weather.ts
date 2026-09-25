import type { WeatherInfo } from '@shared/types'

const TTL = 30 * 60 * 1000
let cache: { at: number; value: WeatherInfo | undefined } | undefined
let inflight: Promise<WeatherInfo | undefined> | undefined

interface GeoResponse {
  city?: string
  country_name?: string
  latitude?: number
  longitude?: number
}

interface OpenMeteoResponse {
  current?: { temperature_2m?: number; weather_code?: number; is_day?: number; apparent_temperature?: number }
}

async function locate(): Promise<GeoResponse | undefined> {
  // Coarse, IP-based location; good enough for a city name and the weather.
  try {
    const res = await fetch('https://ipapi.co/json/', { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(6000) })
    if (res.ok) {
      const json = (await res.json()) as GeoResponse
      if (json.latitude !== undefined && json.longitude !== undefined) return json
    }
  } catch {
    /* try the next provider */
  }
  try {
    const res = await fetch('https://ipwho.is/', { signal: AbortSignal.timeout(6000) })
    if (res.ok) {
      const json = (await res.json()) as { city?: string; country?: string; latitude?: number; longitude?: number; success?: boolean }
      if (json.success !== false && json.latitude !== undefined && json.longitude !== undefined) {
        return { city: json.city, country_name: json.country, latitude: json.latitude, longitude: json.longitude }
      }
    }
  } catch {
    /* offline */
  }
  return undefined
}

/** Current conditions for wherever the machine is, cached for half an hour. */
export function getWeather(force = false): Promise<WeatherInfo | undefined> {
  if (!force && cache && Date.now() - cache.at < TTL) return Promise.resolve(cache.value)
  if (inflight) return inflight
  inflight = (async () => {
    try {
      const geo = await locate()
      if (!geo) return cache?.value
      const url = new URL('https://api.open-meteo.com/v1/forecast')
      url.searchParams.set('latitude', String(geo.latitude))
      url.searchParams.set('longitude', String(geo.longitude))
      url.searchParams.set('current', 'temperature_2m,apparent_temperature,weather_code,is_day')
      url.searchParams.set('timezone', 'auto')
      const res = await fetch(url, { signal: AbortSignal.timeout(8000) })
      if (!res.ok) return cache?.value
      const json = (await res.json()) as OpenMeteoResponse
      const current = json.current
      if (!current || current.temperature_2m === undefined) return cache?.value
      const value: WeatherInfo = {
        city: geo.city ?? '',
        country: geo.country_name ?? '',
        temperature: Math.round(current.temperature_2m),
        feelsLike: current.apparent_temperature !== undefined ? Math.round(current.apparent_temperature) : undefined,
        code: current.weather_code ?? 0,
        isDay: current.is_day !== 0,
        fetchedAt: Date.now()
      }
      cache = { at: Date.now(), value }
      return value
    } catch {
      return cache?.value
    } finally {
      inflight = undefined
    }
  })()
  return inflight
}
