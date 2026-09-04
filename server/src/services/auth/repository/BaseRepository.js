// Interface

export default class BaseRepository {
  constructor(model) {
    this.model = model;
  }

  async create(data) {
    throw new Error("Method not implemented");
  }
  async findById(id) {
    throw new Error("Method not implemented");
  }
  async findByUsername(username) {
    throw new Error("Method not implemented");
  }
  async findByEmail(email) {
    throw new Error("Method not implemented");
  }
  async findAll() {
    throw new Error("Method not implemented");
  }
  async count(filter = {}) {
    throw new Error("Method not implemented");
  }
}
