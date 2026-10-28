class R_photo {
  photoId = "Temp";
  imageUrl = "Temp";
  dateAdded = "Temp";


  constructor(photoId, imageUrl, dateAdded) {
    this.photoId = photoId;
    this.imageUrl = imageUrl;
    this.dateAdded = dateAdded;
  }
  
  // GETTERS
    getPhotoId() {
        return this.photoId;
    }

    getImageUrl() {
        return this.imageUrl;
    }

    getDateAdded() {
        return this.dateAdded;
    }

    // SETTERS
    setPhotoId(photoId) {
        this.photoId = photoId;
    }

    setImageUrl(imageUrl) {
        this.imageUrl = imageUrl;
    }

    setDateAdded(dateAdded) {
        this.dateAdded = dateAdded;
    }


    //methods

    uploadPhoto(newImageUrl, dateAdded) {
        if (typeof newImageUrl === "string" && //makes sure it is a string
            newImageUrl.trim() !== "") { //makes sure nonempty (checks that there is substance after removing whitespace before/after a URL)
            this.setImageUrl(newImageUrl);
            this.setDateAdded(dateAdded);
        }
    }

    deletePhoto() {
        this.setImageUrl(null);
        this.setDateAdded(null);
    }

    viewPhoto() {
        return this.getImageUrl();
    }


}