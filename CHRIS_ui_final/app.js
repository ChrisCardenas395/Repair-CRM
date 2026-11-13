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

  // --------------------------POP UP MENU------------------------- */
  document.getElementById("date-picker").valueAsDate = new Date();

  // Create Order & Orde Details Pop up Menu
function openForm() {
    document.getElementById("popupOverlay").style.display = "flex";
  }
function closeForm() {
  document.getElementById("popupOverlay").style.display = "none";
  }
function closeDetails() {
  document.getElementById("detailsOverlay").style.display = "none";
  }
function showOrderDetails(orderData) {
  document.getElementById("detailHeader").textContent = `${orderData.deviceType} for ${orderData.firstName}`;
  document.getElementById("detailSubHeader").textContent = `Order #${orderData.deviceID}`;
  document.getElementById("detailPLink").textContent = `Personalized Link: `;
  document.getElementById("detailName").textContent = `${orderData.firstName} ${orderData.lastName}`;
  document.getElementById("detailEmail").textContent = orderData.email;
  document.getElementById("detailPhone").textContent = orderData.phone;
  document.getElementById("detailDeviceType").textContent = orderData.deviceType;
  document.getElementById("detailBrand").textContent = orderData.brand;
  document.getElementById("detailModel").textContent = orderData.model;
  document.getElementById("detailDeviceID").textContent = orderData.deviceID;
  document.getElementById("detailSerial").textContent = orderData.serialNumber;
  document.getElementById("detailComplaint").textContent = orderData.complaint;

  document.getElementById("detailsOverlay").style.display = "flex";
  }

//Prevent the form from refreshing the page
document.getElementById("repairOrderForm").addEventListener("submit", function (event) {
  event.preventDefault();

const orderData = {
    firstName: document.getElementById("first_name").value.trim(),
    lastName: document.getElementById("last_name").value.trim(),
    email: document.getElementById("email").value.trim(),
    phone: document.getElementById("phone").value.trim(),
    deviceType: document.getElementById("deviceType").value.trim(),
    brand: document.getElementById("brand").value.trim(),
    deviceID: document.getElementById("deviceID").value.trim(),
    model: document.getElementById("model").value.trim(),
    serialNumber: document.getElementById("serialNumber").value.trim(),
    complaint: document.getElementById("complaint").value.trim(),
  };

  // Grab values from the form inputs
  const firstName = document.getElementById("first_name").value.trim();
  const lastName = document.getElementById("last_name").value.trim();
  const brand = document.getElementById("brand").value.trim();
  const model = document.getElementById("model").value.trim();
  const deviceType = document.getElementById("deviceType").value.trim();
  const deviceID = document.getElementById("deviceID").value.trim();
  const complaint = document.getElementById("complaint").value.trim();

  // Create the new order card element
  const newCard = document.createElement("button");
  newCard.type = "button";
  newCard.className = "order-card"; // Uses your existing .order-card styling

  // Order Cards display name
  newCard.innerHTML = `
    <strong>${deviceType}</strong><br>
  `;

  //Display full details when clicked
  newCard.addEventListener("click", function () {
    // Highlight the active card in the sidebar
    document.querySelectorAll(".orders-sidebar .order-card").forEach((card) => {
      card.classList.remove("active");
    });
    newCard.classList.add("active");

    // Populate and open the details pop-up
    showOrderDetails(orderData);
  });

  // Insert the new card directly above the "Create New Order" button
  // Because it inserts right before the button, older cards stay above it and get pushed to the top
  const sidebar = document.querySelector(".orders-sidebar");
  const createBtn = document.querySelector(".create-order");
  sidebar.insertBefore(newCard, createBtn);

   // Clear the form fields and close the pop-up
  event.target.reset();
  closeForm();
})
// Create Order & Order Details Pop up Menu End
// --------------------------POP UP MENU------------------------- */
