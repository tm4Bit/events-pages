const db = new Dexie("GMLeadsDB");
db.version(2)
  .stores({
    leads: "++id, status, timestamp",
  })
  .upgrade((tx) => {
    console.log("Upgrading GMLeadsDB to version 2");
  });

/**
 * Saves a lead to IndexedDB when the application is offline.
 * @param {object} leadData - The lead data object from the form.
 * @returns {Promise}
 */
async function saveLeadOffline(leadData) {
  try {
    const recordToStore = {
      ...leadData,
      status: "pending",
      timestamp: new Date().toISOString(),
    };
    const id = await db.leads.add(recordToStore);
    console.log(`Lead saved offline with ID: ${id}`, recordToStore);
    updateSyncButtonVisibility();
    return id;
  } catch (error) {
    console.error("Error saving lead offline:", error);
  }
}

/**
 * Note: This function sends a single lead as an object, typically for
 * 'application/x-www-form-urlencoded'. The main batch sync uses 'application/json' with an array.
 * Kept for potential different use cases or granular retries if API supports it.
 * @param {object} leadRecord - The full lead record from IndexedDB.
 * @returns {Promise}
 */
async function syncSingleLeadToServer(leadRecord) {
  const apiEndpoint = "https://leadshowgm.ovlk.com.br/api/leads";
  console.log(
    "Attempting to sync single lead record (form-urlencoded):",
    leadRecord,
  );

  const payload = { ...leadRecord };
  delete payload.id;
  delete payload.status;
  delete payload.timestamp;

  try {
    const response = await fetch(apiEndpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams(payload).toString(),
    });

    if (response.ok) {
      console.log(
        `Single Lead (ID: ${leadRecord.id}) synced successfully (form-urlencoded)!`,
      );
      await db.leads.update(leadRecord.id, { status: "synced" });
      return await response.json();
    } else {
      const errorData = await response.text();
      console.error(
        `Failed to sync single lead ${leadRecord.id} (form-urlencoded). Status: ${response.status}. Response:`,
        errorData,
      );
      throw new Error(`API Error: ${response.status} - ${errorData}`);
    }
  } catch (error) {
    console.error(
      `Network or other error syncing single lead ${leadRecord.id} (form-urlencoded):`,
      error,
    );
    throw error;
  }
}

/**
 * Syncs all pending leads from IndexedDB to the API as a single JSON array.
 */
async function syncAllPendingLeads() {
  if (!navigator.onLine) {
    console.log("Offline. Sync deferred.");
    alert(
      "You are currently offline. Please connect to the internet to sync leads.",
    );
    return;
  }

  const syncButton = document.getElementById("syncLeadsButton");
  const obrigadoModal = document.getElementById("obrigado");
  const loader = document.getElementById("loader");

  if (syncButton) {
    syncButton.disabled = true;
    syncButton.textContent = "Syncing...";
  }
  if (loader) loader.style.display = "block";

  let pendingLeadsRecords = [];
  try {
    pendingLeadsRecords = await db.leads
      .where("status")
      .equals("pending")
      .sortBy("timestamp");

    if (pendingLeadsRecords.length === 0) {
      console.log("No pending leads to sync.");
      updateSyncButtonVisibility(); // Ensures button hides if count is 0
      if (loader) loader.style.display = "none";
      if (syncButton) syncButton.textContent = "Sync Offline Leads";
      return;
    }

    console.log(
      `Found ${pendingLeadsRecords.length} pending leads. Preparing batch to be sent as a JSON array.`,
    );

    const leadsPayloadArray = pendingLeadsRecords.map((record) => {
      const payload = { ...record };
      delete payload.id;
      delete payload.status;
      delete payload.timestamp;
      return payload;
    });

    // const apiEndpoint = "https://leadshowgm.ovlk.com.br/api/leads";
    const apiEndpoint = "http://localhost:8080/api/leads";
    // This log confirms that an array is being sent, regardless of its length (1 or more).
    console.log(
      `Sending a JSON array of ${leadsPayloadArray.length} lead(s) to ${apiEndpoint}`,
    );

    const response = await fetch(apiEndpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(leadsPayloadArray), // Will be an array string: "[{lead1}]" or "[{lead1}, {lead2}]"
    });

    if (response.ok) {
      const responseData = await response.json();
      console.log(
        `Batch of ${pendingLeadsRecords.length} lead(s) synced successfully! API Response:`,
        responseData,
      );

      const leadIdsToUpdate = pendingLeadsRecords.map((lead) => lead.id);
      await db.leads
        .where("id")
        .anyOf(leadIdsToUpdate)
        .modify({ status: "synced" });

      alert(`${pendingLeadsRecords.length} lead(s) synced successfully!`);
      if (obrigadoModal && pendingLeadsRecords.length > 0) {
        // Only show modal if leads were actually synced
        window.location.href = "#obrigado";
      }
    } else {
      const errorData = await response.text();
      console.error(
        `Failed to sync batch of leads. Status: ${response.status}. Response:`,
        errorData,
      );
      alert(
        `Failed to sync leads. Server responded with status ${response.status}. Please try again later.`,
      );
    }
  } catch (error) {
    console.error("Error during batch sync process:", error);
    alert(
      "An error occurred during the sync process. Please check the console for details.",
    );
  } finally {
    if (syncButton) syncButton.disabled = false;
    if (loader) loader.style.display = "none";
    updateSyncButtonVisibility();
  }
}

/**
 * Creates and shows a sync button if there are pending leads and the user is online.
 */
async function updateSyncButtonVisibility() {
  let syncButton = document.getElementById("syncLeadsButton");
  const pendingLeadsCount = await db.leads
    .where("status")
    .equals("pending")
    .count();

  if (navigator.onLine && pendingLeadsCount > 0) {
    if (!syncButton) {
      syncButton = document.createElement("button");
      syncButton.id = "syncLeadsButton";
      syncButton.style.position = "fixed";
      syncButton.style.bottom = "20px";
      syncButton.style.right = "20px";
      syncButton.style.padding = "10px 20px";
      syncButton.style.backgroundColor = "#007bff";
      syncButton.style.color = "white";
      syncButton.style.border = "none";
      syncButton.style.borderRadius = "5px";
      syncButton.style.cursor = "pointer";
      syncButton.style.zIndex = "10000";
      syncButton.onclick = syncAllPendingLeads;
      document.body.appendChild(syncButton);
    }
    syncButton.textContent = `Sync Offline Leads (${pendingLeadsCount})`;
    syncButton.style.display = "block";
  } else {
    if (syncButton) {
      syncButton.style.display = "none";
    }
  }
}

// Listen for online/offline status changes
window.addEventListener("online", updateSyncButtonVisibility);
window.addEventListener("offline", updateSyncButtonVisibility);

// Initial check when the script loads
document.addEventListener("DOMContentLoaded", () => {
  updateSyncButtonVisibility();
});
