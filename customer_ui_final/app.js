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

// --------------------------COLLAPSE----------------------------- */
var coll = document.getElementsByClassName("collapsible");
var i;

for (i = 0; i < coll.length; i++) {
  coll[i].addEventListener("click", function() {
    this.classList.toggle("active");
    var content = this.nextElementSibling;
    var column = this.closest(".work-column");
    if (content.style.display === "block") {
      content.style.display = "none";
      column.classList.remove("expanded");
      column.classList.add("collapsed");
    } else {
      content.style.display = "block";
      column.classList.remove("collapsed");
      column.classList.add("expanded");
    }
  });
}
// --------------------------COLLAPSE----------------------------- */

// ----------------------------PHOTO----------------------------- */

const input = document.getElementById('photo-input');
const preview = document.getElementById('photo-preview');

input.addEventListener('change', function() {
  preview.innerHTML = '';

  const files = this.files;

  Array.from(files).forEach(file => {
    if (file.type.startsWith('image/')) {
      const img = document.createElement('img');

      img.src = URL.createObjectURL(file);
      img.style.width = '100%';
      img.style.height = '100%';
      img.style.objectFit = 'cover';

      preview.appendChild(img);
    }
  });
});
// ----------------------------PHOTO----------------------------- */

// -------------------------- ORDER TRACKER ------------------------- */
const workColumns = document.querySelector(".work-columns");
const ordersStrip = document.querySelector(".orders-strip");

const dividers = [
  document.querySelector(".capsule-divider-one"),
  document.querySelector(".capsule-divider-two"),
  document.querySelector(".capsule-divider-three"),
  document.querySelector(".capsule-divider-four"),
  document.querySelector(".capsule-divider-five")
];

function updateOrdersLayout() {
  const columns = [...workColumns.querySelectorAll(".work-column")];

  let currentWidth = 20;

  columns.forEach((column, index) => {
    currentWidth += column.getBoundingClientRect().width;

    if (index < dividers.length) {
      dividers[index].style.left = `${currentWidth}px`;
    }

    currentWidth += 18; // Column gap
  });

  const totalWidth = columns.reduce(
    (sum, column) => sum + column.getBoundingClientRect().width,
    0
  );

  ordersStrip.style.width = `${totalWidth + (columns.length - 1) * 18}px`;
}

const observer = new ResizeObserver(updateOrdersLayout);

workColumns.querySelectorAll(".work-column").forEach(column => {
  observer.observe(column);
});

updateOrdersLayout();
// -------------------------- ORDER TRACKER ------------------------- */