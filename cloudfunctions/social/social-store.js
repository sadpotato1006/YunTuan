function createSocialStore(db, isNotFoundError) {
  async function readDocument(collectionName, id) {
    try {
      const result = await db.collection(collectionName).doc(id).get();
      return result && result.data ? result.data : null;
    } catch (error) {
      if (isNotFoundError(error)) return null;
      throw error;
    }
  }

  async function readTransactionDocument(reference) {
    try {
      const result = await reference.get();
      return result && result.data ? result.data : null;
    } catch (error) {
      if (isNotFoundError(error)) return null;
      throw error;
    }
  }

  async function readDocuments(collectionName, query, limit) {
    const response = await db.collection(collectionName).where(query).limit(limit || 30).get();
    return response && Array.isArray(response.data) ? response.data : [];
  }

  async function readAllDocuments(collectionName, query, pageSize) {
    const size = Math.max(20, Math.min(100, Number(pageSize) || 100));
    const records = [];
    let offset = 0;
    while (true) {
      let request = db.collection(collectionName).where(query);
      if (offset && typeof request.skip === "function") request = request.skip(offset);
      else if (offset) break;
      const response = await request.limit(size).get();
      const page = response && Array.isArray(response.data) ? response.data : [];
      records.push(...page);
      if (page.length < size) break;
      offset += page.length;
    }
    return records;
  }

  async function removeDocument(collectionName, id) {
    try {
      await db.collection(collectionName).doc(id).remove();
    } catch (error) {
      if (!isNotFoundError(error)) throw error;
    }
  }

  async function removeWhere(collectionName, query) {
    for (let batch = 0; batch < 200; batch += 1) {
      const records = await readDocuments(collectionName, query, 100);
      if (!records.length) return;
      await Promise.all(records.map(record => removeDocument(collectionName, record._id)));
      if (records.length < 100) return;
    }
    throw new Error(`批量删除 ${collectionName} 超过安全上限，请重试`);
  }

  return {
    readDocument,
    readTransactionDocument,
    readDocuments,
    readAllDocuments,
    removeDocument,
    removeWhere
  };
}

module.exports = { createSocialStore };
