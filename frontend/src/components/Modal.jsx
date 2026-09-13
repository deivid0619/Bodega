export default function Modal({ open, onClose, children }) {
  if (!open) return null
  return (
    <div className="modal" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="panel">{children}</div>
    </div>
  )
}
