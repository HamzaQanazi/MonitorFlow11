// Map mode for Requests Management (v5 amendment) — clustered, category-
// colored pins over OSM tiles, driven by the same filters as the list. Not a
// route: RequestsPage swaps this in for the table. Owns its fetch because the
// map wants one big page (100 = the API max) instead of the list's 20.
import { useEffect, useRef, useState } from 'react'
import L from 'leaflet'
import { MapContainer, Marker, TileLayer, Tooltip, useMap } from 'react-leaflet'
import MarkerClusterGroup from 'react-leaflet-cluster'
import 'leaflet/dist/leaflet.css'
import { apiFetch } from '../lib/api'

const POLL_MS = 30_000
const MAP_PAGE_SIZE = 100 // API max — the documented map data-volume limit
const NABLUS: [number, number] = [32.22, 35.26]

interface MapRow {
  id: number
  serviceTypeName: string
  status: { key: string; label: string; category: string | null }
  location: { lat: number; lng: number } | null
  assignedEmployee: { id: number; name: string } | null
}

interface Props {
  category: string
  serviceTypeId: string
  priority: string
  q: string
  employeeId: string
  openDetail: (id: number) => void
}

// L.divIcon everywhere — CSS-token colors, and it sidesteps the Leaflet/Vite
// default-marker-asset bug entirely.
function pinIcon(category: string | null) {
  return L.divIcon({
    className: '',
    html: `<span class="map-pin is-${category ?? 'closed'}"></span>`,
    iconSize: [18, 18],
    iconAnchor: [9, 18],
  })
}

// Clusters mix categories, so they may not borrow a category color
// (Status-Owns-Color) — neutral count circle.
function clusterIcon(cluster: { getChildCount(): number }) {
  return L.divIcon({
    className: '',
    html: `<span class="map-cluster">${cluster.getChildCount()}</span>`,
    iconSize: [34, 34],
  })
}

// Fit the camera to the markers once per filter change, then leave the
// user's pan/zoom alone across polls.
function FitToMarkers({ points, fitKey }: { points: [number, number][]; fitKey: string }) {
  const map = useMap()
  const fitted = useRef<string | null>(null)
  useEffect(() => {
    if (fitted.current === fitKey || points.length === 0) return
    fitted.current = fitKey
    map.fitBounds(L.latLngBounds(points), { padding: [40, 40], maxZoom: 16 })
  }, [map, points, fitKey])
  return null
}

export default function RequestsMapView({ category, serviceTypeId, priority, q, employeeId, openDetail }: Props) {
  const [rows, setRows] = useState<MapRow[] | null>(null)
  const [total, setTotal] = useState(0)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    const load = () => {
      const qs = new URLSearchParams({ page: '1', pageSize: String(MAP_PAGE_SIZE) })
      if (category) qs.set('category', category)
      if (serviceTypeId) qs.set('serviceTypeId', serviceTypeId)
      if (priority) qs.set('priority', priority)
      if (q) qs.set('q', q)
      if (employeeId) qs.set('employeeId', employeeId)
      apiFetch<{ requests: MapRow[]; total: number }>(`/requests?${qs.toString()}`)
        .then((res) => {
          if (cancelled) return
          setRows(res.requests)
          setTotal(res.total)
          setError(null)
        })
        .catch((err: Error) => {
          // Keep the last good pins on a failed poll; surface the error only
          // when there is nothing to show yet.
          if (!cancelled) setError(err.message)
        })
    }
    load()
    const timer = setInterval(load, POLL_MS)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [category, serviceTypeId, priority, q, employeeId])

  if (rows === null) {
    return error ? (
      <div className="req-status">
        <p className="req-status-msg">Couldn’t load the map: {error}</p>
      </div>
    ) : (
      <div className="req-skeleton" aria-busy="true">
        <span className="visually-hidden">Loading map…</span>
        <div className="skel-row" aria-hidden="true" />
      </div>
    )
  }

  const located = rows.filter((r) => r.location !== null)
  const missing = rows.length - located.length
  const points = located.map((r) => [r.location!.lat, r.location!.lng] as [number, number])
  const fitKey = [category, serviceTypeId, priority, q, employeeId].join('|')

  return (
    <div className="req-mapwrap">
      {total > MAP_PAGE_SIZE && (
        <p className="req-map-banner" role="status">
          Showing the first {MAP_PAGE_SIZE} of {total} requests — narrow the filters to see the rest.
        </p>
      )}
      {located.length === 0 ? (
        <div className="req-empty">
          <h2>Nothing to map</h2>
          <p>No requests matching these filters carry a location.</p>
        </div>
      ) : (
        <div className="req-map">
          <MapContainer center={NABLUS} zoom={12} scrollWheelZoom>
            <TileLayer
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
              url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
            />
            <FitToMarkers points={points} fitKey={fitKey} />
            <MarkerClusterGroup iconCreateFunction={clusterIcon} showCoverageOnHover={false}>
              {located.map((r) => (
                <Marker
                  key={r.id}
                  position={[r.location!.lat, r.location!.lng]}
                  icon={pinIcon(r.status.category)}
                  eventHandlers={{ click: () => openDetail(r.id) }}
                >
                  <Tooltip direction="top" offset={[0, -16]}>
                    #{r.id} · {r.serviceTypeName} · {r.status.label}
                    {r.assignedEmployee ? ` · ${r.assignedEmployee.name}` : ''}
                  </Tooltip>
                </Marker>
              ))}
            </MarkerClusterGroup>
          </MapContainer>
        </div>
      )}
      {missing > 0 && (
        <p className="req-map-footnote">
          {missing} request{missing === 1 ? '' : 's'} without a location {missing === 1 ? 'is' : 'are'} not shown.
        </p>
      )}
    </div>
  )
}
