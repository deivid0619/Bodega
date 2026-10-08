import Sheet from './Sheet'

// Ventana modal = hoja inferior con fondo oscurecido (dialogo centrado en
// pantallas grandes). Ver Sheet para el comportamiento de arrastre.
export default function Modal({ onClose, label, children }) {
  return (
    <Sheet modal onClose={onClose} label={label}>
      {children}
    </Sheet>
  )
}
