export default function LoadingScreen({ label = 'Cargando…' }) {
  return (
    <main className="centered-page" aria-live="polite" aria-busy="true">
      <div className="spinner" />
      <p>{label}</p>
    </main>
  )
}
