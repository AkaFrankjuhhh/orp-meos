/* Porto profielmodule: profielpopup, trainingen en telefoonnummer. */

function renderQualificationList(container, items, completed) {
  const completedSet = new Set(completed || []);
  const achieved = items.filter((item) => completedSet.has(item));
  container.innerHTML = achieved.length
    ? achieved.map((item) => `<span class="porto-training-pill">${escapeHtml(item)}</span>`).join("")
    : '<span class="muted">Nog niets behaald.</span>';
}

function renderPortoProfileDialog() {
  if (!portoProfile) return;
  $("#portoProfileAvatar").src = avatarFor(portoProfile);
  $("#portoProfileNameService").textContent = `${portoProfile.name || "Onbekend"} - ${portoProfile.serviceNumber || "-"}`;
  $("#portoProfileRank").textContent = portoProfile.rank || "-";
  $("#portoPhone").value = portoProfile.portoPhone || "";
  renderQualificationList($("#portoTrainingList"), profileTrainings, portoProfile.completedTrainings);
  renderQualificationList($("#portoOperationalList"), profileOperational, portoProfile.completedOperational);
}

function openPortoProfileDialog() {
  renderPortoProfileDialog();
  $("#portoProfileDialog").showModal();
}

async function loadPortoProfile() {
  try {
    const response = await fetch("/api/auth/me");
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      showPortoInlineError(payload.error || "Porto sessie is verlopen. Log opnieuw in.");
      setPortoLocked(true);
      return;
    }
    const auth = await response.json();
    portoProfile = auth.profile || {};
    $("#portoCurrentAvatar").src = avatarFor(portoProfile);
    $("#portoCurrentName").textContent = portoProfile.name || "Onbekend";
    $("#portoCurrentService").textContent = portoProfile.serviceNumber || "-";
    setPortoLocked(false);
    renderStatusButtons();
    await loadPortoDuty();
  } catch (error) {
    showPortoInlineError("Porto kon je profiel niet laden. Controleer de verbinding of probeer opnieuw.");
    setPortoLocked(true);
  }
}

window.PortoModules.registerFeature("profile", { ready: true });
