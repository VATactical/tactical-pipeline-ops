export default function LoadingScreen() {
  return (
    <main className="centered-page" aria-live="polite" aria-busy="true">
      <div className="spinner" />
      <p>Verificando sesión…</p>
    </main>
  )
}
