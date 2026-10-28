class R_photo {
  photoId = "Temp";
  imageUrl = "Temp";
  dateAdded = "Temp";


  constructor(photoId, imageUrl, dateAdded) {
    this.photoId = this.photoId;
    this.imageUrl = this.imageUrl;
    this.dateAdded = this.dateAdded;
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


}