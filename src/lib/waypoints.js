import waypointsGeoJson from '../assets/waypoints.geojson'

// Flat array of visible waypoints, usable for distance/ETA calculations
export const waypoints = waypointsGeoJson.features
  .filter(f => f.properties.visible !== false)
  .map(f => ({
    wp_number: f.properties.wp_number,
    name:      f.properties.name,
    latitude:  f.geometry.coordinates[1],
    longitude: f.geometry.coordinates[0],
    status:    f.properties.status
  }))
