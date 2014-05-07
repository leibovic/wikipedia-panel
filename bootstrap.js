const { classes: Cc, interfaces: Ci, utils: Cu } = Components;

Cu.import("resource://gre/modules/AddonManager.jsm");
Cu.import("resource://gre/modules/Home.jsm");
Cu.import("resource://gre/modules/HomeProvider.jsm");
Cu.import("resource://gre/modules/Prompt.jsm");
Cu.import("resource://gre/modules/Services.jsm");
Cu.import("resource://gre/modules/Task.jsm");
Cu.import("resource://gre/modules/XPCOMUtils.jsm");

const ADDON_ID = "wikipedia.panel@margaretleibovic.com";
const PANEL_ID = "wikipedia.panel@margaretleibovic.com";
const DATASET_ID = "wikipedia.dataset@margaretleibovic.com";

const FEED_PREF = "wikipediaPanel.feed";

// In meters
const EARTH_RADIUS = 6371 * 1000;

const DEFAULT_IMAGE = "http://bits.wikimedia.org/apple-touch/wikipedia.png";

XPCOMUtils.defineLazyGetter(this, "Strings", function() {
  return Services.strings.createBundle("chrome://wikipediapanel/locale/wikipediapanel.properties");
});

XPCOMUtils.defineLazyGetter(this, "FeedHelper", function() {
  let win = Services.wm.getMostRecentWindow("navigator:browser");
  Services.scriptloader.loadSubScript("chrome://wikipediapanel/content/FeedHelper.js", win);
  return win["FeedHelper"];
});

var Feeds = ["potd", "featured", "onthisday", "nearby"];

function getFeed() {
  try {
    // First check to see if the user has set a pref for this add-on.
    let feed = Services.prefs.getCharPref(FEED_PREF);
    if (Feeds.indexOf(feed) > -1) {
      return feed;
    }
  } catch (e) {}

  // Default to the featured feed.
  return "featured";
}

function optionsCallback() {
  return {
    title: Strings.GetStringFromName("title"),
    views: [{
      type: Home.panels.View.LIST,
      dataset: DATASET_ID,
      onrefresh: refreshDataset
    }]
  };
}

function refreshDataset() {
  let feed = getFeed();
  if (feed == "nearby") {
    saveNearbyItems();
  } else {
    saveFeedItems(feed);
  }
}

function saveNearbyItems() {
  let win = Services.wm.getMostRecentWindow("navigator:browser");
  win.navigator.geolocation.getCurrentPosition(function (location){
    let userPoint = {
      lat: location.coords.latitude,
      lon: location.coords.longitude
    }

    let params = {
      action: "query",
      format: "json",
      colimit: "max",
      prop: "pageimages|coordinates",
      pithumbsize: 180,
      pilimit: 50,
      generator: "geosearch",
      ggsradius: 10000,
      ggsnamespace: 0,
      ggslimit: 50,
      ggscoord: userPoint.lat + "|" + userPoint.lon
    };

    let queryUrl = formatQueryUrl(params);
    getRequest(queryUrl, function (response) {
      let items = [];
      let pages = JSON.parse(response).query.pages;
      for (p in pages) {
        let page = pages[p];
        items.push({
          url: "http://" + Strings.GetStringFromName("domain")  + "/wiki/" + encodeURIComponent(page.title),
          title: page.title,
          image_url: page.thumbnail ? page.thumbnail.source : DEFAULT_IMAGE,
          description: formatDistance(userPoint, page.coordinates[0])
        });
      }

      Task.spawn(function() {
        let storage = HomeProvider.getStorage(DATASET_ID);
        yield storage.deleteAll();
        yield storage.save(items);
      }).then(null, e => Cu.reportError("Error saving data to HomeProvider: " + e));
    });
  });
}

function saveFeedItems(feed) {
  let params = {
    action: "featuredfeed",
    feed: feed
  };

  let feedUrl = formatQueryUrl(params);
  FeedHelper.parseFeed(feedUrl, function(parsedFeed) {
    let items = FeedHelper.feedToItems(parsedFeed).map(function(item){
      // Image URLs don't include a scheme
      item.image_url = "http:" + item.image_url;
      return item;
    });

    Task.spawn(function() {
      let storage = HomeProvider.getStorage(DATASET_ID);
      yield storage.deleteAll();
      yield storage.save(items);
    }).then(null, e => Cu.reportError("Error saving data to HomeProvider: " + e));
  });
}

function getRequest(url, callback) {
  let xhr = Cc["@mozilla.org/xmlextras/xmlhttprequest;1"].createInstance(Ci.nsIXMLHttpRequest);
  try {
    xhr.open("GET", url, true);
  } catch (e) {
    Cu.reportError("Error opening request to " + url + ": " + e);
    return;
  }
  xhr.onerror = function onerror(e) {
    Cu.reportError("Error making request to " + url + ": " + e.error);
  };
  xhr.onload = function onload(event) {
    if (xhr.status === 200) {
      callback(xhr.responseText);
    } else {
      Cu.reportError("Request to " + url + " returned status " + xhr.status);
    }
  };
  xhr.send(null);
}

function formatQueryUrl(params) {
  let str = [];
  for (let p in params) {
    str.push(encodeURIComponent(p) + "=" + encodeURIComponent(params[p]));
  }
  return "http://" + Strings.GetStringFromName("domain") + "/w/api.php?" + str.join("&");
}

// Logic from http://www.movable-type.co.uk/scripts/latlong.html
function formatDistance(p1, p2) {
  function toRadians(n) {
    return n * Math.PI / 180;
  }

  let lat1 = toRadians(p1.lat);
  let lat2 = toRadians(p2.lat);
  let dlat = toRadians(p2.lat - p1.lat);
  let dlon = toRadians(p2.lon - p1.lon);

  let a = Math.sin(dlat/2) * Math.sin(dlat/2) +
          Math.cos(lat1) * Math.cos(lat2) *
          Math.sin(dlon/2) * Math.sin(dlon/2);
  let c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));

  // Round to the nearest meter
  let d = Math.round(EARTH_RADIUS * c);
  return d + " m";
}

function deleteDataset() {
  Task.spawn(function() {
    let storage = HomeProvider.getStorage(DATASET_ID);
    yield storage.deleteAll();
  }).then(null, e => Cu.reportError("Error deleting data from HomeProvider: " + e));
}

function optionsDisplayed(doc, topic, id) {
  if (id != ADDON_ID) {
    return;
  }

  let setting = doc.getElementById("feed-setting");
  setting.setAttribute("title", Strings.GetStringFromName("feed.label"));

  let select = doc.getElementById("feed-select");
  for (let feed of Feeds) {
    let option = doc.createElement("option");
    option.value = feed;
    option.textContent = Strings.GetStringFromName(feed);
    select.appendChild(option);
  }

  select.value = getFeed();

  select.addEventListener("change", function() {
    Services.prefs.setCharPref(FEED_PREF, select.value);
    HomeProvider.requestSync(DATASET_ID, refreshDataset);
  }, false);
}

/**
 * bootstrap.js API
 * https://developer.mozilla.org/en-US/Add-ons/Bootstrapped_extensions
 */
function startup(data, reason) {
  // Always register your panel on startup.
  Home.panels.register(PANEL_ID, optionsCallback);

  switch(reason) {
    case ADDON_INSTALL:
    case ADDON_ENABLE:
      Home.panels.install(PANEL_ID);
      refreshDataset();
      break;

    case ADDON_UPGRADE:
    case ADDON_DOWNGRADE:
      Home.panels.update(PANEL_ID);
      break;
  }

  // Update data once every hour.
  HomeProvider.addPeriodicSync(DATASET_ID, 3600, refreshDataset);

  Services.obs.addObserver(optionsDisplayed, AddonManager.OPTIONS_NOTIFICATION_DISPLAYED, false);
}

function shutdown(data, reason) {
  if (reason == ADDON_UNINSTALL || reason == ADDON_DISABLE) {
    Home.panels.uninstall(PANEL_ID);
    HomeProvider.removePeriodicSync(DATASET_ID);
    deleteDataset();
  }

  Home.panels.unregister(PANEL_ID);

  Services.obs.removeObserver(optionsDisplayed, AddonManager.OPTIONS_NOTIFICATION_DISPLAYED);
}

function install(data, reason) {}

function uninstall(data, reason) {}
