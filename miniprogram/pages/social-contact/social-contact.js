const profileService = require("../../services/social-profile");
const socialService = require("../../services/social");

const EMPTY_EXCHANGE = { status: "none", myContact: null, peerContact: null };

Page({
  data: {
    conversationId: "",
    loading: true,
    saving: false,
    contactExchange: EMPTY_EXCHANGE,
    localOptions: []
  },

  onLoad(options) {
    const conversationId = decodeURIComponent(String(options && options.conversationId || ""));
    if (!/^[a-f0-9]{64}$/.test(conversationId)) {
      wx.showToast({ title: "会话编号无效", icon: "none" });
      setTimeout(() => wx.navigateBack(), 600);
      return;
    }
    this.setData({ conversationId });
  },

  onShow() {
    if (this.data.conversationId) this.loadContactExchange();
  },

  onPullDownRefresh() {
    this.loadContactExchange();
  },

  async loadContactExchange() {
    if (this._loading) return;
    this._loading = true;
    try {
      const result = await socialService.getContactExchange(this.data.conversationId);
      const contactExchange = normalizeContactExchange(result.contactExchange);
      if (contactExchange.status !== "accepted") {
        wx.showToast({ title: "双方尚未同意交换联系方式", icon: "none" });
        setTimeout(() => wx.navigateBack(), 600);
        return;
      }
      this.setData({
        loading: false,
        contactExchange,
        localOptions: decorateLocalOptions(
          profileService.getProfile().contactOptions,
          sharedContactIds(contactExchange.myContact)
        )
      });
    } catch (error) {
      this.setData({ loading: false });
      wx.showToast({ title: error.message || "联系方式加载失败", icon: "none" });
    } finally {
      this._loading = false;
      wx.stopPullDownRefresh();
    }
  },

  toggleOption(event) {
    if (this.data.saving) return;
    const optionId = String(event.currentTarget.dataset.id || "");
    this.setData({
      localOptions: this.data.localOptions.map(option => option.id === optionId
        ? Object.assign({}, option, { selected: !option.selected })
        : option)
    });
  },

  manageLocalOptions() {
    wx.navigateTo({ url: "/pages/social-profile/social-profile" });
  },

  previewQr(event) {
    const source = String(event.currentTarget.dataset.src || "");
    if (source) wx.previewImage({ urls: [source], current: source });
  },

  async shareSelected() {
    if (this.data.saving) return;
    const selected = this.data.localOptions.filter(option => option.selected);
    if (!selected.length) {
      wx.showToast({ title: "请至少选择一条资料", icon: "none" });
      return;
    }
    this.setData({ saving: true });
    try {
      const result = await socialService.shareContact(this.data.conversationId, selected);
      const contactExchange = normalizeContactExchange(result.contactExchange);
      this.setData({
        contactExchange,
        localOptions: decorateLocalOptions(
          profileService.getProfile().contactOptions,
          sharedContactIds(contactExchange.myContact)
        )
      });
      wx.showToast({ title: "已分享所选资料", icon: "success" });
    } catch (error) {
      wx.showToast({ title: error.message || "分享失败", icon: "none" });
    } finally {
      this.setData({ saving: false });
    }
  },

  confirmWithdraw() {
    wx.showModal({
      title: "撤回我的联系方式",
      content: "撤回后云端不再向对方展示，但对方已经复制、保存或截图的内容无法追回。",
      confirmText: "确认撤回",
      confirmColor: "#C06052",
      success: result => { if (result.confirm) this.withdrawContact(); }
    });
  },

  async withdrawContact() {
    if (this.data.saving) return;
    this.setData({ saving: true });
    try {
      const result = await socialService.withdrawContact(this.data.conversationId);
      const contactExchange = normalizeContactExchange(result.contactExchange);
      this.setData({
        contactExchange,
        localOptions: decorateLocalOptions(profileService.getProfile().contactOptions, [])
      });
      wx.showToast({ title: "已撤回", icon: "success" });
    } catch (error) {
      wx.showToast({ title: error.message || "撤回失败", icon: "none" });
    } finally {
      this.setData({ saving: false });
    }
  }
});

function normalizeContactExchange(value) {
  const source = value && typeof value === "object" ? value : EMPTY_EXCHANGE;
  return {
    status: String(source.status || "none"),
    myContact: normalizeSharedContact(source.myContact),
    peerContact: normalizeSharedContact(source.peerContact)
  };
}

function normalizeSharedContact(value) {
  if (!value || typeof value !== "object") return null;
  return {
    items: Array.isArray(value.items) ? value.items.slice() : [],
    updatedAt: Number(value.updatedAt) || 0
  };
}

function sharedContactIds(contact) {
  return contact && Array.isArray(contact.items)
    ? contact.items.map(item => String(item.id || "")).filter(Boolean)
    : [];
}

function decorateLocalOptions(options, selectedIds) {
  const selected = new Set(Array.isArray(selectedIds) ? selectedIds : []);
  return profileService.normalizeContactOptions(options).map(option => Object.assign({}, option, {
    selected: selected.has(option.id),
    previewSource: option.localPath || option.qrCodeFileId || ""
  }));
}
