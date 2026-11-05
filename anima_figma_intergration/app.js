const searchForm = document.querySelector(".search-form");
const searchInput = document.querySelector("#workspace-search");
const customerRequest = document.querySelector(".customer-request");
const emptyState = document.querySelector(".empty-state");
const closeRequestButton = document.querySelector(".close-request");
const createOrderButton = document.querySelector(".create-order");
const workColumnButtons = document.querySelectorAll(".add-work-item");

function updateSearchResults(query) {
  const normalizedQuery = query.trim().toLowerCase();
  const searchableText = customerRequest.dataset.searchable || "";
  const isMatch = !normalizedQuery || searchableText.includes(normalizedQuery);

  customerRequest.hidden = !isMatch;
  emptyState.hidden = isMatch;

  console.log("__ANIMA_DBG__ Search state updated", {
    query: normalizedQuery,
    isMatch,
  });
}

searchForm.addEventListener("submit", (event) => {
  event.preventDefault();
  console.log("__ANIMA_DBG__ Search submitted", {
    query: searchInput.value,
  });
  updateSearchResults(searchInput.value);
});

searchInput.addEventListener("input", () => {
  updateSearchResults(searchInput.value);
});

closeRequestButton.addEventListener("click", () => {
  customerRequest.hidden = true;
  emptyState.textContent = "No customer requests available.";
  emptyState.hidden = false;
  console.log("__ANIMA_DBG__ Customer request closed");
});

createOrderButton.addEventListener("click", () => {
  console.log("__ANIMA_DBG__ Create order selected");
});

workColumnButtons.forEach((button, index) => {
  button.addEventListener("click", () => {
    const column = button.closest(".work-column");

    if (column.querySelector(".work-item")) {
      console.log("__ANIMA_DBG__ Workspace item already exists", {
        column: index + 1,
      });
      return;
    }

    const item = document.createElement("div");
    item.className = "work-item";
    item.textContent = "New Work Item";
    column.appendChild(item);

    console.log("__ANIMA_DBG__ Workspace item added", {
      column: index + 1,
    });
  });
});
