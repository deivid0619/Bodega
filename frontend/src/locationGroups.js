// Agrupa las ubicaciones de la distribución en optgroups por mueble, para
// los selects de "elegir ubicación".
export function locationGroups(elements) {
  return (elements || [])
    .filter((el) => el.locations && el.locations.length)
    .map((el) => ({ label: el.name, options: el.locations }))
}
