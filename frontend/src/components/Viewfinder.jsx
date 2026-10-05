import Icon from './Icon'

// El visor de la camara para escanear etiquetas (lo usa useBarcodeScanner).
export default function Viewfinder({ scanner, className = '' }) {
  const { status, message, videoRef, containerRef, start } = scanner
  const camOn = status === 'native' || status === 'lib'
  return (
    <div className={`viewfinder ${className}`}>
      {status !== 'lib' && <video ref={videoRef} playsInline muted style={{ display: status === 'native' ? 'block' : 'none' }} />}
      <div id="cam-reader" ref={containerRef} style={{ display: status === 'lib' ? 'block' : 'none' }} />
      {status === 'off' && (
        <button className="vf-idle" onClick={start}>
          <Icon name="camera" size={34} stroke={1.7} />
          Toca para abrir la cámara
        </button>
      )}
      {status === 'fail' && (
        <div className="vf-fail">
          <Icon name="alert" size={28} />
          {message}
          <button className="btn btn-lime btn-sm" onClick={start}>Intentar de nuevo</button>
        </div>
      )}
      {camOn && (
        <>
          <div className="vf-corners" aria-hidden="true"><i /><i /><i /><i /></div>
          <div className="vf-laser" aria-hidden="true" />
        </>
      )}
      {camOn && message && <p className="vf-msg">{message}</p>}
    </div>
  )
}
