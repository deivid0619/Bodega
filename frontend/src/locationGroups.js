// Agrupa las ubicaciones de la distribucion en optgroups por mueble, para
// los selects de "elegir ubicacion". Al final va Despacho: la mercancia de
// paso (llega solo para despacharse), que no es un mueble.
export const DISPATCH = 'DESPACHO'

export function locationGroups(elements, { dispatch = true } = {}) {
  const groups = (elements || [])
    .filter((el) => el.locations && el.locations.length)
    .map((el) => ({ label: el.name, options: el.locations }))
  if (dispatch && groups.length) groups.push({ label: 'De paso', options: [{ id: DISPATCH, kind: 'dispatch', name: 'Despacho (de paso)' }] })
  return groups
}
