export function WebEntry() {
  return (
    <main className="hosted-shell">
      <p className="eyebrow">Drone.Works</p>
      <h1>Verified identity required</h1>
      <p>
        This build does not include the local development identity control. A
        verified session provider must be configured before hosted access is
        enabled.
      </p>
    </main>
  );
}
