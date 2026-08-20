// Small "view on map" affordance for a single captured coordinate — Time
// Clock's clock-in/clock-out points (028_time_shift_clock_coordinates.sql,
// a deliberate re-scope of I10's "no location" default: a manager may view
// where a shift's clock-in/out happened). Deliberately minimal: one pin, no
// clustering, no polling — reuses RequestsMapView's tile source/pin styling
// (already imported by TimeClockPage.tsx via RequestsPage.css) so a map
// looks the same everywhere it appears in the console.
import { useState } from 'react'
import L from 'leaflet'
import { MapContainer, Marker, TileLayer } from 'react-leaflet'
import 'leaflet/dist/leaflet.css'
import { useI18n } from '../i18n'

function pinIcon() {
  return L.divIcon({
    className: '',
    html: '<span class="map-pin is-open"></span>',
    iconSize: [18, 18],
    iconAnchor: [9, 18],
  })
}

export default function LocationPin({
  location,
  title,
}: {
  location: { lat: number; lng: number }
  title: string
}) {
  const { t } = useI18n()
  const [open, setOpen] = useState(false)

  return (
    <>
      <button
        type="button"
        className="tc-location-btn"
        onClick={() => setOpen(true)}
        aria-label={t('tc_view_location')}
        title={t('tc_view_location')}
      >
        <span className="map-pin is-open" aria-hidden="true" />
      </button>
      {open && (
        <div className="dialog-backdrop" onClick={() => setOpen(false)}>
          <div
            className="dialog tc-location-dialog"
            role="dialog"
            aria-modal="true"
            aria-label={title}
            onClick={(e) => e.stopPropagation()}
          >
            <h4>{title}</h4>
            <div className="tc-location-map">
              <MapContainer center={[location.lat, location.lng]} zoom={15} scrollWheelZoom={false}>
                <TileLayer
                  attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
                  url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
                />
                <Marker position={[location.lat, location.lng]} icon={pinIcon()} />
              </MapContainer>
            </div>
            <div className="dialog-actions">
              <button type="button" className="req-retry" onClick={() => setOpen(false)}>
                {t('close')}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
