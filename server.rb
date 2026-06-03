require "json"
require "digest"
require "openssl"
require "securerandom"
require "time"
require "webrick"
require "csv"
require "net/http"
require "uri"
require "cgi"
require "fileutils"

ROOT = File.expand_path(__dir__)
DEFAULT_DATA_FILE = File.join(ROOT, "data", "store.json")
DATA_FILE = File.expand_path(ENV.fetch("GATHERTRAY_DATA_FILE", DEFAULT_DATA_FILE), ROOT)
BACKUP_DIR = File.expand_path(ENV.fetch("GATHERTRAY_BACKUP_DIR", File.join(ROOT, "data", "backups")), ROOT)
BIND_ADDRESS = ENV.fetch("GATHERTRAY_BIND", "127.0.0.1")
PORT = ENV.fetch("PORT", "4567").to_i
SESSION_TTL_SECONDS = 60 * 60 * 24 * 7
PASSWORD_ITERATIONS = 120_000
PASSWORD_DIGEST = "sha256"
LOGIN_RATE_LIMIT = { "limit" => 8, "window" => 15 * 60 }.freeze
SIGNUP_RATE_LIMIT = { "limit" => 5, "window" => 60 * 60 }.freeze
PASSWORD_RATE_LIMIT = { "limit" => 6, "window" => 30 * 60 }.freeze

def parse_lead_time_hours(value)
  match = value.to_s.match(/(\d+)/)
  match ? match[1].to_i : 24
end

class RateLimitError < StandardError
  attr_reader :retry_after

  def initialize(message, retry_after)
    super(message)
    @retry_after = retry_after.to_i
  end
end

class SimpleRateLimiter
  def initialize
    @entries = {}
    @mutex = Mutex.new
  end

  def consume!(key, limit:, window:)
    retry_after = nil
    @mutex.synchronize do
      prune_expired!(window)
      now = Time.now.to_i
      entry = (@entries[key] ||= { "count" => 0, "windowStartedAt" => now })
      if now - entry["windowStartedAt"] >= window
        entry["count"] = 0
        entry["windowStartedAt"] = now
      end
      entry["count"] += 1
      if entry["count"] > limit
        retry_after = [window - (now - entry["windowStartedAt"]), 1].max
      end
    end
    return unless retry_after

    raise RateLimitError.new("Too many attempts. Please wait before trying again.", retry_after)
  end

  def reset!(key)
    @mutex.synchronize { @entries.delete(key) }
  end

  private

  def prune_expired!(window)
    now = Time.now.to_i
    @entries.delete_if { |_key, entry| (now - entry["windowStartedAt"]) >= window }
  end
end

class GatherTrayStore
  def initialize(path)
    @path = path
    ensure_store_exists!
    ensure_backup_dir!
    migrate_passwords!
    migrate_sessions!
    migrate_issues!
    migrate_reviews!
    migrate_notifications!
    migrate_restaurants!
  end

  def read
    JSON.parse(File.read(@path))
  end

  def write(data)
    File.write(@path, JSON.pretty_generate(data))
  end

  def ensure_store_exists!
    return if File.exist?(@path)

    FileUtils.mkdir_p(File.dirname(@path))
    seed = JSON.parse(File.read(DEFAULT_DATA_FILE))
    File.write(@path, JSON.pretty_generate(seed))
  end

  def ensure_backup_dir!
    FileUtils.mkdir_p(BACKUP_DIR)
  end

  def restaurants
    read.fetch("restaurants")
  end

  def visible_restaurants_for(user)
    source = user && %w[admin restaurant].include?(user["role"]) ? restaurants : restaurants.select { |restaurant| restaurant["listingStatus"].to_s != "paused" }
    source.map { |restaurant| restaurant_summary(restaurant) }
  end

  def restaurant(slug)
    restaurants.find { |item| item["slug"] == slug }
  end

  def reviews
    read.fetch("reviews", [])
  end

  def reviews_for_restaurant(slug)
    reviews.select { |item| item["restaurantSlug"] == slug }.sort_by { |item| item["createdAt"].to_s }.reverse
  end

  def next_review_id
    max_id = reviews.map { |item| item["id"].to_s.split("-").last.to_i }.max || 0
    "REV-#{max_id + 1}"
  end

  def restaurant_summary(restaurant)
    items = reviews_for_restaurant(restaurant["slug"])
    base_reviews = restaurant["baseReviews"].to_i
    base_rating = restaurant["baseRating"].to_f
    total_reviews = base_reviews + items.length
    total_score = (base_rating * base_reviews) + items.sum { |item| item["rating"].to_f }
    computed_rating = total_reviews.positive? ? (total_score / total_reviews) : 0.0
    restaurant.merge(
      "rating" => computed_rating.round(1),
      "reviews" => total_reviews,
      "recentReviews" => items.first(5)
    )
  end

  def orders
    read.fetch("orders")
  end

  def order(id)
    orders.find { |item| item["id"] == id }
  end

  def issues
    read.fetch("issues")
  end

  def normalize_issue(issue)
    {
      "id" => issue["id"] || next_issue_id,
      "order" => issue["order"].to_s,
      "issue" => issue["issue"].to_s,
      "owner" => issue["owner"].to_s.empty? ? "Support" : issue["owner"].to_s,
      "priority" => issue["priority"].to_s.empty? ? "Medium" : issue["priority"].to_s,
      "status" => issue["status"].to_s.empty? ? "Open" : issue["status"].to_s,
      "createdByEmail" => issue["createdByEmail"].to_s,
      "createdByRole" => issue["createdByRole"].to_s,
      "createdAt" => issue["createdAt"] || Time.now.utc.iso8601,
      "updatedAt" => issue["updatedAt"] || issue["createdAt"] || Time.now.utc.iso8601
    }
  end

  def applications
    read.fetch("applications", [])
  end

  def users
    read.fetch("users", [])
  end

  def sessions
    read.fetch("sessions", [])
  end

  def next_session_id
    max_id = sessions.map { |item| item["id"].to_s.split("-").last.to_i }.max || 0
    "SES-#{max_id + 1}"
  end

  def notifications
    read.fetch("notifications", []).map { |item| normalize_notification(item) }
  end

  def email_log
    read.fetch("emailLog", [])
  end

  def user(id)
    users.find { |item| item["id"] == id }
  end

  def user_by_email(email)
    users.find { |item| item["email"].to_s.downcase == email.to_s.downcase }
  end

  def add_order(order)
    data = read
    data["orders"].unshift(order)
    write(data)
    order
  end

  def add_application(application)
    data = read
    data["applications"] ||= []
    data["applications"].unshift(application)
    write(data)
    application
  end

  def add_issue(issue)
    data = read
    data["issues"] ||= []
    normalized = normalize_issue(issue)
    data["issues"].unshift(normalized)
    write(data)
    normalized
  end

  def add_user(user)
    data = read
    data["users"] ||= []
    user["favorites"] ||= []
    user["savedSearches"] ||= []
    password_record = build_password_record(user.delete("password"))
    user["passwordHash"] = password_record["passwordHash"]
    user["passwordSalt"] = password_record["passwordSalt"]
    user["passwordAlgo"] = password_record["passwordAlgo"]
    user["passwordIterations"] = password_record["passwordIterations"]
    data["users"] << user
    write(data)
    sanitize_user(user)
  end

  def update_user_profile(user_id, attrs)
    data = read
    user = data.fetch("users").find { |item| item["id"] == user_id }
    raise "User not found" unless user

    name = attrs["name"].to_s.strip
    raise "Missing name" if name.empty?

    user["name"] = name
    write(data)
    sanitize_user(user)
  end

  def update_user_password(user_id, current_password, new_password)
    data = read
    user = data.fetch("users").find { |item| item["id"] == user_id }
    raise "User not found" unless user
    raise "Current password is incorrect" unless valid_password?(user, current_password.to_s)
    raise "Password must be at least 8 characters" if new_password.to_s.length < 8
    raise "New password must be different from your current password" if current_password.to_s == new_password.to_s

    password_record = build_password_record(new_password)
    user["passwordHash"] = password_record["passwordHash"]
    user["passwordSalt"] = password_record["passwordSalt"]
    user["passwordAlgo"] = password_record["passwordAlgo"]
    user["passwordIterations"] = password_record["passwordIterations"]
    user.delete("password")
    write(data)
    sanitize_user(user)
  end

  def create_session(user_id)
    data = read
    data["sessions"] ||= []
    now = Time.now.utc.iso8601
    token = SecureRandom.hex(24)
    session = {
      "id" => next_session_id,
      "token" => token,
      "userId" => user_id,
      "createdAt" => now,
      "lastSeenAt" => now
    }
    data["sessions"] << session
    write(data)
    session
  end

  def delete_session(token)
    data = read
    data["sessions"] = data.fetch("sessions", []).reject { |item| item["token"] == token }
    write(data)
  end

  def delete_session_by_id(user_id, session_id)
    data = read
    data["sessions"] ||= []
    before = data["sessions"].length
    data["sessions"] = data["sessions"].reject { |item| item["userId"] == user_id && item["id"] == session_id }
    raise "Session not found" if before == data["sessions"].length
    write(data)
    { "ok" => true }
  end

  def delete_other_sessions(user_id, current_token)
    data = read
    data["sessions"] ||= []
    removed = data["sessions"].count { |item| item["userId"] == user_id && item["token"] != current_token }
    data["sessions"] = data["sessions"].reject { |item| item["userId"] == user_id && item["token"] != current_token }
    write(data)
    { "ok" => true, "removed" => removed }
  end

  def session(token)
    sessions.find { |item| item["token"] == token }
  end

  def touch_session(token)
    data = read
    current = data.fetch("sessions", []).find { |item| item["token"] == token }
    return nil unless current
    current["lastSeenAt"] = Time.now.utc.iso8601
    current["id"] = next_session_id if current["id"].to_s.empty?
    write(data)
    current
  end

  def user_from_token(token)
    active = session(token)
    return nil unless active
    return nil if session_expired?(active)
    user(active["userId"])
  end

  def sessions_for_user(user_id, current_token = nil)
    sessions
      .select { |item| item["userId"] == user_id }
      .map { |item| sanitize_session(item, current_token) }
      .sort_by { |item| item["lastSeenAt"].to_s }
      .reverse
  end

  def favorites_for_user(user)
    current = self.user(user["id"]) || user
    Array(current["favorites"]).map do |slug|
      restaurant(slug)
    end.compact
  end

  def saved_searches_for_user(user)
    current = self.user(user["id"]) || user
    Array(current["savedSearches"])
  end

  def toggle_favorite(user_id, restaurant_slug)
    data = read
    user = data.fetch("users").find { |item| item["id"] == user_id }
    raise "User not found" unless user
    raise "Restaurant not found" unless restaurant(restaurant_slug)

    user["favorites"] ||= []
    if user["favorites"].include?(restaurant_slug)
      user["favorites"].delete(restaurant_slug)
      saved = false
    else
      user["favorites"] << restaurant_slug
      saved = true
    end
    write(data)
    { "saved" => saved, "favorites" => user["favorites"] }
  end

  def add_saved_search(user_id, attrs)
    data = read
    user = data.fetch("users").find { |item| item["id"] == user_id }
    raise "User not found" unless user

    user["savedSearches"] ||= []
    search = {
      "id" => next_saved_search_id(user["savedSearches"]),
      "name" => attrs["name"].to_s.strip.empty? ? "Saved search" : attrs["name"].to_s.strip,
      "zip" => attrs["zip"].to_s.strip,
      "cuisine" => attrs["cuisine"].to_s.strip,
      "guests" => attrs["guests"].to_i,
      "budgetMode" => attrs["budgetMode"].to_s.strip,
      "budgetAmount" => attrs["budgetAmount"].to_f.round(2),
      "deliveryMode" => attrs["deliveryMode"].to_s.strip,
      "occasion" => attrs["occasion"].to_s.strip,
      "minimum" => attrs["minimum"].to_s.strip,
      "sort" => attrs["sort"].to_s.strip,
      "createdAt" => Time.now.utc.iso8601
    }
    user["savedSearches"].unshift(search)
    write(data)
    search
  end

  def delete_saved_search(user_id, search_id)
    data = read
    user = data.fetch("users").find { |item| item["id"] == user_id }
    raise "User not found" unless user

    before = Array(user["savedSearches"]).length
    user["savedSearches"] = Array(user["savedSearches"]).reject { |item| item["id"] == search_id }
    raise "Saved search not found" if before == user["savedSearches"].length
    write(data)
    { "ok" => true }
  end

  def add_review(user, attrs)
    data = read
    data["reviews"] ||= []
    order = data.fetch("orders").find { |item| item["id"] == attrs["orderId"].to_s }
    raise "Order not found" unless order
    raise "Only completed orders can be reviewed" unless order["status"] == "Completed"
    raise "You can only review your own completed orders" unless order["customerEmail"].to_s.downcase == user["email"].to_s.downcase
    raise "Review already exists for this order" if data["reviews"].any? { |item| item["orderId"] == order["id"] }

    rating = attrs["rating"].to_i
    raise "Rating must be between 1 and 5" unless rating.between?(1, 5)

    review = {
      "id" => next_review_id,
      "orderId" => order["id"],
      "restaurantSlug" => order["restaurantSlug"],
      "restaurantName" => order["restaurantName"],
      "customerEmail" => user["email"],
      "customerName" => order["customer"],
      "rating" => rating,
      "comment" => attrs["comment"].to_s.strip,
      "createdAt" => Time.now.utc.iso8601
    }
    data["reviews"].unshift(review)
    write(data)
    review
  end

  def session_expired?(session)
    created = Time.parse(session["createdAt"].to_s)
    (Time.now.utc - created) > SESSION_TTL_SECONDS
  rescue StandardError
    true
  end

  def notifications_for_email(email)
    notifications
      .select { |item| item["userEmail"].to_s.downcase == email.to_s.downcase }
      .sort_by { |item| item["createdAt"].to_s }
      .reverse
  end

  def add_notification(notification)
    data = read
    data["notifications"] ||= []
    data["notifications"].unshift(normalize_notification(notification))
    write(data)
    data["notifications"].first
  end

  def next_email_id
    max_id = email_log.map { |item| item["id"].to_s.split("-").last.to_i }.max || 0
    "EML-#{max_id + 1}"
  end

  def queue_email(email)
    data = read
    data["emailLog"] ||= []
    record = {
      "id" => email["id"] || next_email_id,
      "to" => email["to"].to_s,
      "subject" => email["subject"].to_s,
      "body" => email["body"].to_s,
      "status" => email["status"].to_s.empty? ? "queued" : email["status"].to_s,
      "createdAt" => email["createdAt"] || Time.now.utc.iso8601
    }
    data["emailLog"].unshift(record)
    write(data)
    record
  end

  def audit_logs
    read.fetch("auditLogs", [])
  end

  def security_events(limit = 12)
    audit_logs
      .select { |item| item["action"].to_s.start_with?("auth.") }
      .first(limit)
  end

  def security_summary
    cutoff = Time.now.utc - (24 * 60 * 60)
    recent = audit_logs.select do |item|
      item["action"].to_s.start_with?("auth.") && begin
        Time.parse(item["createdAt"].to_s) >= cutoff
      rescue StandardError
        false
      end
    end
    {
      "windowHours" => 24,
      "successfulLogins" => recent.count { |item| item["action"] == "auth.login_succeeded" },
      "failedLogins" => recent.count { |item| item["action"] == "auth.login_failed" },
      "rateLimited" => recent.count { |item| item["action"].to_s.end_with?("rate_limited") },
      "passwordChanges" => recent.count { |item| item["action"] == "auth.password_changed" },
      "latestEventAt" => recent.first && recent.first["createdAt"]
    }
  end

  def latest_activity_at
    timestamps = []
    timestamps.concat(orders.map { |item| item["updatedAt"] || item["createdAt"] })
    timestamps.concat(applications.map { |item| item["approvedAt"] || item["rejectedAt"] || item["changesRequestedAt"] || item["submittedAt"] })
    timestamps.concat(issues.map { |item| item["updatedAt"] || item["createdAt"] })
    timestamps.concat(reviews.map { |item| item["createdAt"] })
    timestamps.concat(notifications.map { |item| item["createdAt"] })
    timestamps.concat(email_log.map { |item| item["createdAt"] })
    timestamps.concat(audit_logs.map { |item| item["createdAt"] })
    timestamps.compact.reject(&:empty?).max
  end

  def backup_summary
    {
      "generatedAt" => Time.now.utc.iso8601,
      "latestActivityAt" => latest_activity_at,
      "counts" => {
        "restaurants" => restaurants.length,
        "orders" => orders.length,
        "applications" => applications.length,
        "users" => users.length,
        "issues" => issues.length,
        "reviews" => reviews.length,
        "notifications" => notifications.length,
        "emails" => email_log.length,
        "auditLogs" => audit_logs.length
      }
    }
  end

  def backup_payload
    {
      "meta" => backup_summary.merge(
        "format" => "gathertray-admin-backup-v1",
        "includesSensitiveAuthData" => false
      ),
      "restaurants" => restaurants,
      "orders" => orders,
      "applications" => applications,
      "users" => users.map { |item| sanitize_user(item) },
      "issues" => issues,
      "reviews" => reviews,
      "notifications" => notifications,
      "emailLog" => email_log,
      "auditLogs" => audit_logs
    }
  end

  def saved_backups(limit = 8)
    Dir.glob(File.join(BACKUP_DIR, "*.json"))
      .sort_by { |path| File.mtime(path) }
      .reverse
      .first(limit)
      .map { |path| backup_file_summary(path) }
  end

  def backup_file_summary(path)
    payload = JSON.parse(File.read(path))
    meta = payload.fetch("meta", {})
    {
      "filename" => File.basename(path),
      "path" => path,
      "sizeBytes" => File.size(path),
      "generatedAt" => meta["generatedAt"] || File.mtime(path).utc.iso8601,
      "latestActivityAt" => meta["latestActivityAt"],
      "counts" => meta["counts"] || {},
      "format" => meta["format"].to_s
    }
  rescue StandardError
    {
      "filename" => File.basename(path),
      "path" => path,
      "sizeBytes" => File.size(path),
      "generatedAt" => File.mtime(path).utc.iso8601,
      "latestActivityAt" => nil,
      "counts" => {},
      "format" => ""
    }
  end

  def create_saved_backup!
    payload = backup_payload
    timestamp = Time.now.utc.strftime("%Y%m%d-%H%M%S")
    filename = "gathertray-backup-#{timestamp}.json"
    path = File.join(BACKUP_DIR, filename)
    File.write(path, JSON.pretty_generate(payload))
    backup_file_summary(path)
  end

  def next_audit_log_id
    max_id = audit_logs.map { |item| item["id"].to_s.split("-").last.to_i }.max || 0
    "AUD-#{max_id + 1}"
  end

  def add_audit_log(entry)
    data = read
    data["auditLogs"] ||= []
    record = {
      "id" => entry["id"] || next_audit_log_id,
      "actorEmail" => entry["actorEmail"].to_s,
      "actorRole" => entry["actorRole"].to_s,
      "action" => entry["action"].to_s,
      "targetType" => entry["targetType"].to_s,
      "targetId" => entry["targetId"].to_s,
      "detail" => entry["detail"].to_s,
      "createdAt" => entry["createdAt"] || Time.now.utc.iso8601
    }
    data["auditLogs"].unshift(record)
    write(data)
    record
  end

  def update_order(id, attrs)
    data = read
    order = data.fetch("orders").find { |item| item["id"] == id }
    raise "Order not found" unless order

    previous_status = order["status"]
    %w[status timeLabel].each do |field|
      order[field] = attrs[field] if attrs.key?(field)
    end
    order["updatedAt"] = Time.now.utc.iso8601
    write(data)
    { "order" => order, "previousStatus" => previous_status }
  end

  def issues_for_user(user)
    normalized = issues.map { |item| normalize_issue(item) }
    return normalized if user["role"] == "admin"

    normalized.select do |issue|
      order = self.order(issue["order"])
      next false unless order
      if user["role"] == "customer"
        order["customerEmail"].to_s.downcase == user["email"].to_s.downcase
      elsif user["role"] == "restaurant"
        order["restaurantSlug"] == user["restaurantSlug"]
      else
        false
      end
    end
  end

  def issue(id)
    issues.map { |item| normalize_issue(item) }.find { |item| item["id"] == id }
  end

  def update_issue(id, attrs)
    data = read
    data["issues"] ||= []
    issue = data["issues"].find { |item| (item["id"] || "").to_s == id.to_s }
    raise "Issue not found" unless issue

    %w[status owner priority].each do |field|
      issue[field] = attrs[field] if attrs.key?(field)
    end
    issue["updatedAt"] = Time.now.utc.iso8601
    write(data)
    normalize_issue(issue)
  end

  def customer_orders(email)
    orders.select { |order| order["customerEmail"].to_s.downcase == email.to_s.downcase }
  end

  def visible_order_for_user(user, id)
    order = self.order(id)
    return nil unless order
    return order if user["role"] == "admin"
    return order if user["role"] == "restaurant" && user["restaurantSlug"] == order["restaurantSlug"]
    return order if user["role"] == "customer" && user["email"].to_s.downcase == order["customerEmail"].to_s.downcase
    nil
  end

  def update_restaurant(slug, attrs)
    data = read
    restaurant = data.fetch("restaurants").find { |item| item["slug"] == slug }
    raise "Restaurant not found" unless restaurant

    %w[description setup leadTime neighborhood deliveryRadius website menuImportNote menuImportSource].each do |field|
      restaurant[field] = attrs[field] if attrs.key?(field)
    end
    %w[minimum deliveryFee perPerson].each do |field|
      restaurant[field] = attrs[field].to_f.round(2) if attrs.key?(field)
    end
    restaurant["leadTimeHours"] = attrs["leadTimeHours"].to_i if attrs.key?("leadTimeHours")
    restaurant["packages"] = attrs["packages"] if attrs["packages"].is_a?(Array) && !attrs["packages"].empty?
    restaurant["tags"] = attrs["tags"] if attrs["tags"].is_a?(Array) && !attrs["tags"].empty?
    restaurant["deliveryModes"] = attrs["deliveryModes"] if attrs["deliveryModes"].is_a?(Array) && !attrs["deliveryModes"].empty?
    restaurant["occasions"] = attrs["occasions"] if attrs["occasions"].is_a?(Array) && !attrs["occasions"].empty?
    restaurant["zipCodes"] = attrs["zipCodes"] if attrs["zipCodes"].is_a?(Array) && !attrs["zipCodes"].empty?
    restaurant["blackoutDates"] = Array(attrs["blackoutDates"]).map(&:to_s).map(&:strip).reject(&:empty?).uniq if attrs.key?("blackoutDates")
    restaurant["listingStatus"] = attrs["listingStatus"].to_s if attrs.key?("listingStatus")
    restaurant["listingStatus"] = "active" if restaurant["listingStatus"].to_s.empty?
    restaurant["pauseReason"] = attrs["pauseReason"].to_s.strip if attrs.key?("pauseReason")
    restaurant["menuImportedAt"] = attrs["menuImportedAt"] if attrs.key?("menuImportedAt")
    restaurant["menuImportCount"] = attrs["menuImportCount"].to_i if attrs.key?("menuImportCount")

    write(data)
    restaurant
  end

  def find_application(id)
    applications.find { |application| application["id"] == id }
  end

  def update_application_metadata(id, attrs)
    data = read
    application = data.fetch("applications", []).find { |item| item["id"] == id }
    raise "Application not found" unless application

    attrs.each do |key, value|
      application[key] = value
    end

    write(data)
    application
  end

  def approve_application(id)
    data = read
    application = data.fetch("applications", []).find { |item| item["id"] == id }
    raise "Application not found" unless application
    raise "Application already approved" if application["status"] == "approved"

    slug = slugify(application["businessName"])
    base_slug = slug
    counter = 2
    while data.fetch("restaurants").any? { |restaurant| restaurant["slug"] == slug }
      slug = "#{base_slug}-#{counter}"
      counter += 1
    end

    restaurant = {
      "slug" => slug,
      "name" => application["businessName"],
      "ownerUserId" => next_user_id,
      "cuisine" => application["cuisine"],
      "neighborhood" => application["city"],
      "rating" => 5.0,
      "reviews" => 0,
      "deliveryFee" => 18,
      "minimum" => application["minimumOrder"].to_f,
      "deliveryRadius" => application["deliveryRadius"],
      "zipCodes" => [],
      "deliveryModes" => ["delivery", "pickup"],
      "occasions" => ["office lunch"],
      "commission" => 0.06,
      "perPerson" => application["packages"].map { |pkg| pkg["price"].to_f }.reject(&:zero?).min || 0.0,
      "leadTime" => "24 hours",
      "leadTimeHours" => 24,
      "setup" => "Pending setup review",
      "description" => application["description"],
      "website" => application["website"].to_s,
      "listingStatus" => "active",
      "pauseReason" => "",
      "blackoutDates" => [],
      "packages" => application["packages"],
      "menuImportSource" => "",
      "menuImportNote" => "",
      "menuImportedAt" => nil,
      "menuImportCount" => 0,
      "tags" => ["Pending first orders", "Approved vendor", "New on GatherTray"],
      "documents" => application["documents"],
      "contactEmail" => application["email"],
      "contactPhone" => application["phone"]
    }

    application["status"] = "approved"
    application["approvedAt"] = Time.now.utc.iso8601
    application["approvedRestaurantSlug"] = slug

    user = {
      "id" => restaurant["ownerUserId"],
      "name" => application["ownerName"],
      "email" => application["email"],
      "password" => "changeme123",
      "role" => "restaurant",
      "restaurantSlug" => slug
    }

    data["restaurants"].unshift(restaurant)
    data["users"] ||= []
    data["users"] << user
    write(data)
    { "application" => application, "restaurant" => restaurant, "user" => sanitize_user(user) }
  end

  def reject_application(id, reason = nil)
    data = read
    application = data.fetch("applications", []).find { |item| item["id"] == id }
    raise "Application not found" unless application
    application["status"] = "rejected"
    application["rejectedAt"] = Time.now.utc.iso8601
    application["rejectionReason"] = reason.to_s.strip
    write(data)
    application
  end

  def request_application_changes(id, note = nil)
    data = read
    application = data.fetch("applications", []).find { |item| item["id"] == id }
    raise "Application not found" unless application
    application["status"] = "changes_requested"
    application["changesRequestedAt"] = Time.now.utc.iso8601
    application["reviewNote"] = note.to_s.strip
    write(data)
    application
  end

  def next_order_id
    max_id = orders.map { |order| order["id"].split("-").last.to_i }.max || 3000
    "GT-#{max_id + 1}"
  end

  def next_application_id
    max_id = applications.map { |application| application["id"].to_s.split("-").last.to_i }.max || 1000
    "APP-#{max_id + 1}"
  end

  def next_user_id
    max_id = users.map { |user| user["id"].to_s.split("-").last.to_i }.max || 2000
    "USR-#{max_id + 1}"
  end

  def next_notification_id
    max_id = notifications.map { |item| item["id"].to_s.split("-").last.to_i }.max || 0
    "NTF-#{max_id + 1}"
  end

  def normalize_notification(notification)
    entity = infer_notification_entity(notification)
    {
      "id" => notification["id"] || next_notification_id,
      "userEmail" => notification["userEmail"].to_s,
      "title" => notification["title"].to_s,
      "body" => notification["body"].to_s,
      "entityType" => notification["entityType"].to_s.empty? ? entity["entityType"].to_s : notification["entityType"].to_s,
      "entityId" => notification["entityId"].to_s.empty? ? entity["entityId"].to_s : notification["entityId"].to_s,
      "createdAt" => notification["createdAt"] || Time.now.utc.iso8601
    }
  end

  def infer_notification_entity(notification)
    text = [notification["title"], notification["body"]].compact.join(" ")
    return { "entityType" => "issue", "entityId" => notification["issueId"] } unless notification["issueId"].to_s.empty?
    return { "entityType" => "application", "entityId" => notification["applicationId"] } unless notification["applicationId"].to_s.empty?
    return { "entityType" => "order", "entityId" => notification["orderId"] } unless notification["orderId"].to_s.empty?

    if (match = text.match(/\bGT-\d+\b/))
      { "entityType" => "order", "entityId" => match[0] }
    elsif (match = text.match(/\bISS-\d+\b/))
      { "entityType" => "issue", "entityId" => match[0] }
    elsif (match = text.match(/\bAPP-\d+\b/))
      { "entityType" => "application", "entityId" => match[0] }
    else
      {}
    end
  end

  def migrate_notifications!
    data = read
    items = data.fetch("notifications", [])
    normalized = items.map { |item| normalize_notification(item) }
    return if normalized == items

    data["notifications"] = normalized
    write(data)
  end

  def next_issue_id
    max_id = issues.map { |item| item["id"].to_s.split("-").last.to_i }.max || 0
    "ISS-#{max_id + 1}"
  end

  def build_password_record(password)
    salt = SecureRandom.hex(16)
    {
      "passwordHash" => pbkdf2_hash(password, salt, PASSWORD_ITERATIONS),
      "passwordSalt" => salt,
      "passwordAlgo" => "pbkdf2-#{PASSWORD_DIGEST}",
      "passwordIterations" => PASSWORD_ITERATIONS
    }
  end

  def pbkdf2_hash(password, salt, iterations)
    OpenSSL::PKCS5.pbkdf2_hmac(password.to_s, salt.to_s, iterations.to_i, 32, PASSWORD_DIGEST).unpack1("H*")
  end

  def legacy_hash_password(password)
    Digest::SHA256.hexdigest(password.to_s)
  end

  def valid_password?(user, password)
    if user["passwordSalt"].to_s.empty? || user["passwordAlgo"].to_s.empty?
      user["passwordHash"] == legacy_hash_password(password)
    else
      expected = pbkdf2_hash(password, user["passwordSalt"], user["passwordIterations"] || PASSWORD_ITERATIONS)
      expected == user["passwordHash"]
    end
  end

  def upgrade_legacy_password!(user_id, password)
    data = read
    user = data.fetch("users").find { |item| item["id"] == user_id }
    return unless user
    return unless user["passwordSalt"].to_s.empty? || user["passwordAlgo"].to_s.empty?

    password_record = build_password_record(password)
    user["passwordHash"] = password_record["passwordHash"]
    user["passwordSalt"] = password_record["passwordSalt"]
    user["passwordAlgo"] = password_record["passwordAlgo"]
    user["passwordIterations"] = password_record["passwordIterations"]
    user.delete("password")
    write(data)
  end

  def sanitize_user(user)
    return nil unless user
    user.reject { |key, _value| %w[password passwordHash passwordSalt passwordAlgo passwordIterations].include?(key) }
  end

  def sanitize_session(session, current_token = nil)
    {
      "id" => session["id"].to_s.empty? ? next_session_id : session["id"],
      "createdAt" => session["createdAt"],
      "lastSeenAt" => session["lastSeenAt"] || session["createdAt"],
      "isCurrent" => current_token && session["token"] == current_token
    }
  end

  private

  def migrate_passwords!
    data = read
    changed = false
    data.fetch("users", []).each do |user|
      if user["passwordHash"].to_s.empty? && !user["password"].to_s.empty?
        password_record = build_password_record(user["password"].to_s)
        user["passwordHash"] = password_record["passwordHash"]
        user["passwordSalt"] = password_record["passwordSalt"]
        user["passwordAlgo"] = password_record["passwordAlgo"]
        user["passwordIterations"] = password_record["passwordIterations"]
        user.delete("password")
        changed = true
      elsif !user["passwordHash"].to_s.empty? && user["passwordSalt"].nil?
        user["passwordSalt"] = ""
        user["passwordAlgo"] = ""
        user["passwordIterations"] = nil
        user.delete("password")
        changed = true
      end
      user["favorites"] ||= []
      user["savedSearches"] ||= []
    end
    data.fetch("restaurants", []).each do |restaurant|
      unless restaurant.key?("blackoutDates")
        restaurant["blackoutDates"] = []
        changed = true
      end
      if restaurant["listingStatus"].to_s.empty?
        restaurant["listingStatus"] = "active"
        changed = true
      end
      if restaurant["leadTimeHours"].to_i <= 0
        restaurant["leadTimeHours"] = parse_lead_time_hours(restaurant["leadTime"])
        changed = true
      end
      unless restaurant.key?("pauseReason")
        restaurant["pauseReason"] = ""
        changed = true
      end
      if restaurant["baseRating"].nil?
        restaurant["baseRating"] = restaurant["rating"].to_f
        changed = true
      end
      if restaurant["baseReviews"].nil?
        restaurant["baseReviews"] = restaurant["reviews"].to_i
        changed = true
      end
    end
    data["reviews"] ||= []
    write(data) if changed
  end

  def next_saved_search_id(saved_searches)
    max_id = Array(saved_searches).map { |item| item["id"].to_s.split("-").last.to_i }.max || 0
    "SRCH-#{max_id + 1}"
  end

  def migrate_issues!
    data = read
    changed = false
    next_id = data.fetch("issues", []).map { |item| item["id"].to_s.split("-").last.to_i }.max || 0
    data.fetch("issues", []).each do |issue|
      unless issue["id"]
        next_id += 1
        issue["id"] = "ISS-#{next_id}"
        changed = true
      end
      if issue["status"].to_s.empty?
        issue["status"] = "Open"
        changed = true
      end
      if issue["createdAt"].to_s.empty?
        issue["createdAt"] = Time.now.utc.iso8601
        changed = true
      end
      if issue["updatedAt"].to_s.empty?
        issue["updatedAt"] = issue["createdAt"]
        changed = true
      end
      if issue["owner"].to_s.empty?
        issue["owner"] = "Support"
        changed = true
      end
      if issue["priority"].to_s.empty?
        issue["priority"] = "Medium"
        changed = true
      end
    end
    write(data) if changed
  end

  def migrate_reviews!
    data = read
    changed = false
    data["reviews"] ||= []
    data.fetch("restaurants", []).each do |restaurant|
      if restaurant["baseRating"].nil?
        restaurant["baseRating"] = restaurant["rating"].to_f
        changed = true
      end
      if restaurant["baseReviews"].nil?
        restaurant["baseReviews"] = restaurant["reviews"].to_i
        changed = true
      end
    end
    write(data) if changed
  end

  def migrate_restaurants!
    data = read
    changed = false
    data["auditLogs"] ||= []
    data.fetch("restaurants", []).each do |restaurant|
      unless restaurant.key?("website")
        restaurant["website"] = ""
        changed = true
      end
      unless restaurant.key?("menuImportSource")
        restaurant["menuImportSource"] = ""
        changed = true
      end
      unless restaurant.key?("menuImportNote")
        restaurant["menuImportNote"] = ""
        changed = true
      end
      unless restaurant.key?("menuImportedAt")
        restaurant["menuImportedAt"] = nil
        changed = true
      end
      unless restaurant.key?("menuImportCount")
        restaurant["menuImportCount"] = 0
        changed = true
      end
    end
    write(data) if changed
  end

  def migrate_sessions!
    data = read
    changed = false
    next_id = data.fetch("sessions", []).map { |item| item["id"].to_s.split("-").last.to_i }.max || 0
    data.fetch("sessions", []).each do |session|
      if session["id"].to_s.empty?
        next_id += 1
        session["id"] = "SES-#{next_id}"
        changed = true
      end
      if session["createdAt"].to_s.empty?
        session["createdAt"] = Time.now.utc.iso8601
        changed = true
      end
      if session["lastSeenAt"].to_s.empty?
        session["lastSeenAt"] = session["createdAt"]
        changed = true
      end
    end
    write(data) if changed
  end

  def slugify(value)
    value.to_s.downcase.gsub(/[^a-z0-9]+/, "-").gsub(/^-|-$/, "")
  end
end

def normalize_restaurant_website(url)
  value = url.to_s.strip
  return "" if value.empty?

  value.match?(/\Ahttps?:\/\//i) ? value : "https://#{value}"
end

def fetch_remote_html(url, limit = 3)
  raise "Website URL is required" if url.to_s.strip.empty?
  raise "Too many redirects while fetching website" if limit <= 0

  uri = URI.parse(normalize_restaurant_website(url))
  http = Net::HTTP.new(uri.host, uri.port)
  http.use_ssl = uri.scheme == "https"
  http.open_timeout = 8
  http.read_timeout = 8

  request = Net::HTTP::Get.new(uri)
  request["User-Agent"] = "GatherTray Menu Importer"
  response = http.request(request)

  case response
  when Net::HTTPSuccess
    response.body.to_s
  when Net::HTTPRedirection
    location = response["location"].to_s
    raise "Website redirected without a valid location" if location.empty?
    fetch_remote_html(location, limit - 1)
  else
    raise "Could not fetch website content (#{response.code})"
  end
end

def extract_menu_packages_from_html(html)
  text = html.to_s
    .gsub(/<script.*?<\/script>/mi, " ")
    .gsub(/<style.*?<\/style>/mi, " ")
    .gsub(/<[^>]+>/, "\n")
  text = CGI.unescapeHTML(text)

  lines = text.split("\n")
    .map { |line| line.gsub(/\s+/, " ").strip }
    .reject(&:empty?)

  packages = lines.each_with_index.map do |line, index|
    next if line.length < 2 || line.length > 180
    next unless line.match?(/\$\s*\d+(?:\.\d{1,2})?/)

    price_match = line.match(/\$\s*(\d+(?:\.\d{1,2})?)/)
    next unless price_match

    before_price = line.split(price_match[0]).first.to_s.gsub(/[\|\-–•:]+$/, "").strip
    after_price = line.split(price_match[0], 2).last.to_s.strip
    prior_line = index.positive? ? lines[index - 1].to_s.strip : ""
    next_line = lines[index + 1].to_s.strip

    name =
      if before_price.empty?
        prior_line
      else
        before_price
      end
    next if name.empty? || name.match?(/\A(?:menu|packages|pricing|catering)\z/i)

    serves_match = [after_price, next_line].map do |candidate|
      candidate.match(/(serves?\s*\d+(?:\s*(?:-|to)\s*\d+)?|\d+\s*(?:-|to)\s*\d+\s*(?:people|guests|servings))/i)
    end.compact.first

    {
      "name" => name[0, 80],
      "price" => price_match[1].to_f.round(2),
      "serves" => serves_match ? serves_match[1] : ""
    }
  end.compact

  packages
    .uniq { |item| [item["name"].downcase, item["price"], item["serves"].downcase] }
    .reject { |item| item["price"] <= 0 }
    .first(20)
end

module GatherTrayMetrics
  module_function

  def restaurant_dashboard(store, restaurant_slug = nil)
    orders = restaurant_slug ? store.orders.select { |order| order["restaurantSlug"] == restaurant_slug } : store.orders
    monthly_revenue = orders.sum { |order| order["subtotal"].to_f }
    payout_pending = orders
      .reject { |order| order["status"] == "Completed" }
      .sum { |order| order["restaurantPayout"].to_f }
    {
      "metrics" => {
        "monthlyRevenue" => monthly_revenue.round(2),
        "payoutPending" => payout_pending.round(2),
        "reorderRate" => "37%",
        "menuViews" => 912
      },
      "incomingOrders" => orders.first(8).map do |order|
        {
          "id" => order["id"],
          "customer" => order["customer"],
          "guests" => order["guests"],
          "total" => order["customerTotal"],
          "status" => order["status"],
          "time" => order["timeLabel"] || order["eventDate"]
        }
      end
    }
  end

  def admin_dashboard(store)
    orders = store.orders
    {
      "metrics" => {
        "gmv" => orders.sum { |order| order["customerTotal"].to_f }.round(2),
        "activeRestaurants" => store.restaurants.count { |restaurant| restaurant["listingStatus"].to_s != "paused" },
        "pausedRestaurants" => store.restaurants.count { |restaurant| restaurant["listingStatus"].to_s == "paused" },
        "openIssues" => store.issues.length,
        "repeatBuyers" => "44%"
      },
      "issues" => store.issues,
      "applications" => store.applications
    }
  end
end

def parse_json_body(req)
  JSON.parse(req.body.to_s)
end

def auth_token(req)
  header = req["Authorization"].to_s
  return nil unless header.start_with?("Bearer ")
  header.sub("Bearer ", "")
end

def request_ip(req)
  req.header["x-forwarded-for"]&.first.to_s.split(",").first.to_s.strip.tap do |forwarded|
    return forwarded unless forwarded.empty?
  end
  req.peeraddr[3].to_s
rescue StandardError
  "unknown"
end

def rate_limit_key(scope, req, identifier = nil)
  [scope, request_ip(req), identifier.to_s.downcase].reject(&:empty?).join(":")
end

def current_user(req, store)
  token = auth_token(req)
  return nil unless token
  user = store.user_from_token(token)
  store.touch_session(token) if user
  user
end

def require_role!(req, store, *roles)
  user = current_user(req, store)
  raise "Authentication required" unless user
  raise "Forbidden" unless roles.include?(user["role"])
  user
end

store = GatherTrayStore.new(DATA_FILE)
rate_limiter = SimpleRateLimiter.new()

server = WEBrick::HTTPServer.new(
  Port: PORT,
  BindAddress: BIND_ADDRESS,
  DocumentRoot: ROOT,
  AccessLog: [],
  Logger: WEBrick::Log.new($stdout, WEBrick::Log::WARN)
)

trap("INT") { server.shutdown }
trap("TERM") { server.shutdown }

def json_response(res, payload, status = 200)
  res.status = status
  res["Content-Type"] = "application/json"
  res["X-Frame-Options"] = "DENY"
  res["X-Content-Type-Options"] = "nosniff"
  res["Referrer-Policy"] = "strict-origin-when-cross-origin"
  res["Cache-Control"] = "no-store"
  res["Access-Control-Allow-Origin"] = "*"
  res["Access-Control-Allow-Headers"] = "Authorization, Content-Type"
  res["Access-Control-Allow-Methods"] = "GET, POST, PUT, DELETE, OPTIONS"
  res.body = JSON.generate(payload)
end

def rate_limit_response(res, error)
  res["Retry-After"] = error.retry_after.to_s
  json_response(res, { "error" => error.message, "retryAfter" => error.retry_after }, 429)
end

def handle_preflight(req, res)
  return false unless req.request_method == "OPTIONS"
  res.status = 204
  res["Access-Control-Allow-Origin"] = "*"
  res["Access-Control-Allow-Headers"] = "Authorization, Content-Type"
  res["Access-Control-Allow-Methods"] = "GET, POST, PUT, DELETE, OPTIONS"
  res["Cache-Control"] = "no-store"
  res.body = ""
  true
end

server.mount_proc "/api/health" do |req, res|
  next if handle_preflight(req, res)
  json_response(res, { "ok" => true, "timestamp" => Time.now.utc.iso8601 })
end

server.mount_proc "/api/bootstrap" do |req, res|
  next if handle_preflight(req, res)
  user = current_user(req, store)
  payload = {
    "restaurants" => store.visible_restaurants_for(user)
  }

  if user&.dig("role") == "admin"
    payload["orders"] = store.orders
    payload["adminDashboard"] = GatherTrayMetrics.admin_dashboard(store)
    payload["applications"] = store.applications
    payload["users"] = store.users.map { |item| store.send(:sanitize_user, item) }
    payload["emailLog"] = store.email_log
    payload["auditLogs"] = store.audit_logs.first(20)
    payload["securityEvents"] = store.security_events
    payload["securitySummary"] = store.security_summary
    payload["backupSummary"] = store.backup_summary
    payload["savedBackups"] = store.saved_backups
  elsif user&.dig("role") == "restaurant"
    payload["orders"] = store.orders.select { |order| order["restaurantSlug"] == user["restaurantSlug"] }
    payload["restaurantDashboard"] = GatherTrayMetrics.restaurant_dashboard(store, user["restaurantSlug"])
  elsif user&.dig("role") == "customer"
    payload["orders"] = store.customer_orders(user["email"])
    payload["favorites"] = store.favorites_for_user(user)
    payload["savedSearches"] = store.saved_searches_for_user(user)
    payload["reviews"] = store.reviews_for_user(user["email"])
  end

  json_response(
    res,
    payload
  )
end

server.mount_proc "/api/restaurants" do |req, res|
  next if handle_preflight(req, res)
  path_parts = req.path.split("/").reject(&:empty?)
  if req.request_method == "POST" && path_parts.length == 4 && path_parts[3] == "import-menu"
    begin
      user = require_role!(req, store, "admin", "restaurant")
      payload = parse_json_body(req)
      restaurant = store.restaurant(path_parts[2])
      raise "Restaurant not found" unless restaurant
      if user["role"] == "restaurant" && user["restaurantSlug"] != restaurant["slug"]
        raise "Forbidden"
      end

      website = normalize_restaurant_website(payload["website"].to_s.empty? ? restaurant["website"] : payload["website"])
      raise "Add a restaurant website before importing menu items" if website.empty?

      html = fetch_remote_html(website)
      packages = extract_menu_packages_from_html(html)
      raise "No menu lines with pricing were detected on that website" if packages.empty?

      imported_at = Time.now.utc.iso8601
      updated = store.update_restaurant(path_parts[2], {
        "website" => website,
        "packages" => packages,
        "perPerson" => packages.map { |pkg| pkg["price"].to_f }.min || restaurant["perPerson"].to_f,
        "menuImportSource" => website,
        "menuImportNote" => "Imported #{packages.length} package(s) from restaurant website. Pricing remains editable in the portal.",
        "menuImportedAt" => imported_at,
        "menuImportCount" => packages.length
      })
      store.add_audit_log(
        "actorEmail" => user["email"],
        "actorRole" => user["role"],
        "action" => "restaurant.menu_imported",
        "targetType" => "restaurant",
        "targetId" => updated["slug"],
        "detail" => "Imported #{packages.length} package(s) from #{website}"
      )
      json_response(res, {
        "restaurant" => store.restaurant_summary(updated),
        "packages" => packages,
        "website" => website,
        "importedAt" => imported_at,
        "message" => "Imported #{packages.length} package(s) from #{website}. Review and edit pricing before saving if needed."
      })
    rescue StandardError => e
      json_response(res, { "error" => e.message }, 422)
    end
    next
  end

  if req.request_method == "PUT" && path_parts.length == 3
    begin
      user = require_role!(req, store, "admin", "restaurant")
      payload = parse_json_body(req)
      restaurant = store.restaurant(path_parts.last)
      raise "Restaurant not found" unless restaurant
      if user["role"] == "restaurant" && user["restaurantSlug"] != restaurant["slug"]
        raise "Forbidden"
      end
      updated_restaurant = store.update_restaurant(path_parts.last, payload)
      store.add_audit_log(
        "actorEmail" => user["email"],
        "actorRole" => user["role"],
        "action" => "restaurant.updated",
        "targetType" => "restaurant",
        "targetId" => updated_restaurant["slug"],
        "detail" => "Restaurant listing fields updated"
      )
      restaurant = store.restaurant_summary(updated_restaurant)
      json_response(res, restaurant)
    rescue StandardError => e
      json_response(res, { "error" => e.message }, 422)
    end
  elsif path_parts.length == 3
    restaurant = store.restaurant(path_parts.last)
    if restaurant
      json_response(res, store.restaurant_summary(restaurant))
    else
      json_response(res, { "error" => "Restaurant not found" }, 404)
    end
  else
    json_response(res, store.visible_restaurants_for(current_user(req, store)))
  end
end

server.mount_proc "/api/menu-import/preview" do |req, res|
  next if handle_preflight(req, res)
  begin
    raise "Method not allowed" unless req.request_method == "POST"
    payload = parse_json_body(req)
    website = normalize_restaurant_website(payload["website"])
    raise "Add a restaurant website before importing menu items" if website.empty?

    html = fetch_remote_html(website)
    packages = extract_menu_packages_from_html(html)
    raise "No menu lines with pricing were detected on that website" if packages.empty?

    json_response(res, {
      "website" => website,
      "packages" => packages,
      "message" => "Imported #{packages.length} draft package(s) from #{website}. Review and edit pricing before submitting."
    })
  rescue StandardError => e
    status = e.message == "Method not allowed" ? 405 : 422
    json_response(res, { "error" => e.message }, status)
  end
end

server.mount_proc "/api/orders" do |req, res|
  next if handle_preflight(req, res)
  path_parts = req.path.split("/").reject(&:empty?)

  if req.request_method == "GET" && path_parts.length == 3
    begin
      user = require_role!(req, store, "admin", "restaurant", "customer")
      order = store.visible_order_for_user(user, path_parts.last)
      raise "Order not found" unless order
      json_response(res, order)
    rescue StandardError => e
      json_response(res, { "error" => e.message }, 404)
    end
    next
  end

  if req.request_method == "PUT" && path_parts.length == 3
    begin
      user = require_role!(req, store, "admin", "restaurant")
      payload = parse_json_body(req)
      order = store.order(path_parts.last)
      raise "Order not found" unless order
      if user["role"] == "restaurant" && user["restaurantSlug"] != order["restaurantSlug"]
        raise "Forbidden"
      end
      result = store.update_order(path_parts.last, payload)
      updated_order = result["order"]
      store.add_audit_log(
        "actorEmail" => user["email"],
        "actorRole" => user["role"],
        "action" => "order.updated",
        "targetType" => "order",
        "targetId" => updated_order["id"],
        "detail" => payload["status"] ? "Status changed from #{result['previousStatus']} to #{updated_order['status']}" : "Order updated"
      )
      if payload["status"] && payload["status"] != result["previousStatus"]
        store.add_notification(
          "id" => store.next_notification_id,
          "userEmail" => updated_order["customerEmail"],
          "title" => "Order status updated",
          "body" => "#{updated_order['id']} is now #{updated_order['status']}.",
          "entityType" => "order",
          "entityId" => updated_order["id"],
          "createdAt" => Time.now.utc.iso8601
        ) unless updated_order["customerEmail"].to_s.empty?
        store.queue_email(
          "to" => updated_order["customerEmail"],
          "subject" => "GatherTray order update: #{updated_order['id']}",
          "body" => "#{updated_order['id']} is now #{updated_order['status']}.",
          "createdAt" => Time.now.utc.iso8601
        ) unless updated_order["customerEmail"].to_s.empty?
      end
      json_response(res, updated_order)
    rescue StandardError => e
      json_response(res, { "error" => e.message }, 422)
    end
    next
  end

  if req.request_method == "GET"
    begin
      user = require_role!(req, store, "admin", "restaurant", "customer")
      orders =
        if user["role"] == "admin"
          store.orders
        elsif user["role"] == "restaurant"
          store.orders.select { |order| order["restaurantSlug"] == user["restaurantSlug"] }
        else
          store.customer_orders(user["email"])
        end
      json_response(res, orders)
    rescue StandardError => e
      json_response(res, { "error" => e.message }, 403)
    end
    next
  end

  unless req.request_method == "POST"
    json_response(res, { "error" => "Method not allowed" }, 405)
    next
  end

  begin
    payload = parse_json_body(req)
    restaurant = store.restaurant(payload["restaurantSlug"])
    raise "Restaurant not found" unless restaurant
    event_date = payload["eventDate"].to_s
    event_time = payload["eventTime"].to_s.strip.empty? ? "12:00" : payload["eventTime"].to_s
    begin
      event_at = Time.parse("#{event_date} #{event_time}")
    rescue StandardError
      raise "Valid event date and time are required"
    end
    minimum_notice = restaurant["leadTimeHours"].to_i
    minimum_notice = parse_lead_time_hours(restaurant["leadTime"]) if minimum_notice <= 0
    if event_at - Time.now < (minimum_notice * 3600)
      raise "#{restaurant['name']} requires at least #{minimum_notice} hours notice"
    end

    guests = payload["guests"].to_i
    per_person = payload["perPerson"].to_f
    subtotal = (guests * per_person).round(2)
    delivery_fee = payload["deliveryType"] == "delivery" ? restaurant["deliveryFee"].to_f : 0.0
    service_fee =
      if subtotal < 250
        9.0
      elsif subtotal < 600
        12.0
      elsif subtotal < 1200
        19.0
      else
        29.0
      end
    processing_fee = (subtotal * 0.029 + 0.3).round(2)
    customer_total = (subtotal + delivery_fee + service_fee + processing_fee).round(2)
    restaurant_payout = (subtotal - subtotal * restaurant["commission"].to_f).round(2)

    created_at = Time.now.utc.iso8601
    order = {
      "id" => store.next_order_id,
      "restaurantSlug" => restaurant["slug"],
      "restaurantName" => restaurant["name"],
      "customer" => payload["customer"].to_s.strip.empty? ? "Unassigned lead" : payload["customer"].to_s.strip,
      "customerEmail" => payload["customerEmail"].to_s.strip,
      "eventDate" => payload["eventDate"],
      "eventTime" => event_time,
      "eventType" => payload["eventType"],
      "guests" => guests,
      "perPerson" => per_person.round(2),
      "budgetMode" => payload["budgetMode"].to_s,
      "budgetAmount" => payload["budgetAmount"].to_f.round(2),
      "budgetTarget" => payload["budgetTarget"].to_f.round(2),
      "subtotal" => subtotal,
      "deliveryFee" => delivery_fee.round(2),
      "serviceFee" => service_fee.round(2),
      "processingFee" => processing_fee,
      "customerTotal" => customer_total,
      "restaurantPayout" => restaurant_payout,
      "deliveryType" => payload["deliveryType"],
      "dietaryNotes" => payload["dietaryNotes"].to_s,
      "status" => "New lead",
      "timeLabel" => payload["eventDate"],
      "createdAt" => created_at,
      "updatedAt" => created_at
    }

    store.add_order(order)
    store.add_notification(
      "id" => store.next_notification_id,
      "userEmail" => order["customerEmail"],
      "title" => "Order request received",
      "body" => "Your GatherTray request #{order['id']} for #{restaurant['name']} has been submitted.",
      "entityType" => "order",
      "entityId" => order["id"],
      "createdAt" => Time.now.utc.iso8601
    ) unless order["customerEmail"].empty?
    store.queue_email(
      "to" => order["customerEmail"],
      "subject" => "GatherTray order request received",
      "body" => "Your GatherTray request #{order['id']} for #{restaurant['name']} has been submitted.",
      "createdAt" => Time.now.utc.iso8601
    ) unless order["customerEmail"].empty?
    json_response(res, order, 201)
  rescue StandardError => e
    json_response(res, { "error" => e.message }, 422)
  end
end

server.mount_proc "/api/export/orders.csv" do |req, res|
  next if handle_preflight(req, res)
  begin
    require_role!(req, store, "admin")
    res.status = 200
    res["Content-Type"] = "text/csv"
    res["Content-Disposition"] = 'attachment; filename="gathertray-orders.csv"'
    res.body = CSV.generate do |csv|
      csv << %w[id restaurant customer customerEmail eventDate eventType guests customerTotal restaurantPayout status]
      store.orders.each do |order|
        csv << [
          order["id"],
          order["restaurantName"],
          order["customer"],
          order["customerEmail"],
          order["eventDate"],
          order["eventType"],
          order["guests"],
          order["customerTotal"],
          order["restaurantPayout"],
          order["status"]
        ]
      end
    end
  rescue StandardError => e
    json_response(res, { "error" => e.message }, 403)
  end
end

server.mount_proc "/api/export/backup.json" do |req, res|
  next if handle_preflight(req, res)
  begin
    user = require_role!(req, store, "admin")
    payload = store.backup_payload
    store.add_audit_log(
      "actorEmail" => user["email"],
      "actorRole" => user["role"],
      "action" => "admin.backup_exported",
      "targetType" => "backup",
      "targetId" => payload.dig("meta", "generatedAt").to_s,
      "detail" => "Exported admin backup snapshot with sanitized user/session data"
    )
    res.status = 200
    res["Content-Type"] = "application/json"
    res["Content-Disposition"] = "attachment; filename=\"gathertray-backup.json\""
    res["X-Frame-Options"] = "DENY"
    res["X-Content-Type-Options"] = "nosniff"
    res["Referrer-Policy"] = "strict-origin-when-cross-origin"
    res["Cache-Control"] = "no-store"
    res["Access-Control-Allow-Origin"] = "*"
    res["Access-Control-Allow-Headers"] = "Authorization, Content-Type"
    res["Access-Control-Allow-Methods"] = "GET, POST, PUT, DELETE, OPTIONS"
    res.body = JSON.pretty_generate(payload)
  rescue StandardError => e
    json_response(res, { "error" => e.message }, 403)
  end
end

server.mount_proc "/api/backups" do |req, res|
  next if handle_preflight(req, res)
  path_parts = req.path.split("/").reject(&:empty?)
  begin
    user = require_role!(req, store, "admin")

    if req.request_method == "GET" && path_parts.length == 2
      json_response(res, { "backups" => store.saved_backups })
      next
    end

    if req.request_method == "POST" && path_parts.length == 2
      backup = store.create_saved_backup!
      store.add_audit_log(
        "actorEmail" => user["email"],
        "actorRole" => user["role"],
        "action" => "admin.backup_created",
        "targetType" => "backup",
        "targetId" => backup["filename"],
        "detail" => "Created saved backup snapshot on the server"
      )
      json_response(res, { "backup" => backup }, 201)
      next
    end

    if req.request_method == "GET" && path_parts.length == 3
      filename = File.basename(path_parts[2].to_s)
      path = File.join(BACKUP_DIR, filename)
      raise "Backup not found" unless File.file?(path)
      store.add_audit_log(
        "actorEmail" => user["email"],
        "actorRole" => user["role"],
        "action" => "admin.backup_downloaded",
        "targetType" => "backup",
        "targetId" => filename,
        "detail" => "Downloaded saved backup snapshot"
      )
      res.status = 200
      res["Content-Type"] = "application/json"
      res["Content-Disposition"] = "attachment; filename=\"#{filename}\""
      res["X-Frame-Options"] = "DENY"
      res["X-Content-Type-Options"] = "nosniff"
      res["Referrer-Policy"] = "strict-origin-when-cross-origin"
      res["Cache-Control"] = "no-store"
      res["Access-Control-Allow-Origin"] = "*"
      res["Access-Control-Allow-Headers"] = "Authorization, Content-Type"
      res["Access-Control-Allow-Methods"] = "GET, POST, PUT, DELETE, OPTIONS"
      res.body = File.read(path)
      next
    end

    json_response(res, { "error" => "Not found" }, 404)
  rescue StandardError => e
    json_response(res, { "error" => e.message }, 403)
  end
end

server.mount_proc "/api/auth/login" do |req, res|
  next if handle_preflight(req, res)
  unless req.request_method == "POST"
    json_response(res, { "error" => "Method not allowed" }, 405)
    next
  end

  begin
    payload = parse_json_body(req)
    email = payload["email"].to_s.strip.downcase
    rate_limiter.consume!(rate_limit_key("login", req, email), limit: LOGIN_RATE_LIMIT["limit"], window: LOGIN_RATE_LIMIT["window"])
    user = store.user_by_email(payload["email"])
    raise "Invalid email or password" unless user && store.valid_password?(user, payload["password"].to_s)
    store.upgrade_legacy_password!(user["id"], payload["password"].to_s)
    user = store.user(user["id"]) || user
    session = store.create_session(user["id"])
    rate_limiter.reset!(rate_limit_key("login", req, email))
    store.add_audit_log(
      "actorEmail" => user["email"],
      "actorRole" => user["role"],
      "action" => "auth.login_succeeded",
      "targetType" => "user",
      "targetId" => user["id"],
      "detail" => "Successful login from #{request_ip(req)}"
    )
    json_response(res, { "user" => store.send(:sanitize_user, user), "token" => session["token"] })
  rescue RateLimitError => e
    store.add_audit_log(
      "actorEmail" => payload && payload["email"].to_s.strip.downcase,
      "actorRole" => "guest",
      "action" => "auth.login_rate_limited",
      "targetType" => "account",
      "targetId" => payload && payload["email"].to_s.strip.downcase,
      "detail" => "Login temporarily rate limited from #{request_ip(req)} for #{e.retry_after} seconds"
    ) rescue nil
    rate_limit_response(res, e)
  rescue StandardError => e
    store.add_audit_log(
      "actorEmail" => payload && payload["email"].to_s.strip.downcase,
      "actorRole" => "guest",
      "action" => "auth.login_failed",
      "targetType" => "account",
      "targetId" => payload && payload["email"].to_s.strip.downcase,
      "detail" => "Login failed from #{request_ip(req)}: #{e.message}"
    ) rescue nil
    json_response(res, { "error" => e.message }, 401)
  end
end

server.mount_proc "/api/auth/logout" do |req, res|
  next if handle_preflight(req, res)
  unless req.request_method == "POST"
    json_response(res, { "error" => "Method not allowed" }, 405)
    next
  end
  token = auth_token(req)
  user = current_user(req, store)
  if user && token
    store.add_audit_log(
      "actorEmail" => user["email"],
      "actorRole" => user["role"],
      "action" => "auth.logout",
      "targetType" => "user",
      "targetId" => user["id"],
      "detail" => "Signed out from #{request_ip(req)}"
    )
  end
  store.delete_session(token) if token
  json_response(res, { "ok" => true })
end

server.mount_proc "/api/auth/signup" do |req, res|
  next if handle_preflight(req, res)
  unless req.request_method == "POST"
    json_response(res, { "error" => "Method not allowed" }, 405)
    next
  end

  begin
    payload = parse_json_body(req)
    rate_limiter.consume!(rate_limit_key("signup", req), limit: SIGNUP_RATE_LIMIT["limit"], window: SIGNUP_RATE_LIMIT["window"])
    raise "Account already exists" if store.user_by_email(payload["email"])
    role = payload["role"].to_s == "restaurant" ? "restaurant" : "customer"
    user = {
      "id" => store.next_user_id,
      "name" => payload["name"].to_s.strip,
      "email" => payload["email"].to_s.strip,
      "password" => payload["password"].to_s,
      "role" => role
    }
    raise "Missing name" if user["name"].empty?
    raise "Missing email" if user["email"].empty?
    raise "Password must be at least 6 characters" if user["password"].length < 6
    created_user = store.add_user(user)
    store.add_audit_log(
      "actorEmail" => created_user["email"],
      "actorRole" => created_user["role"],
      "action" => "auth.signup_created",
      "targetType" => "user",
      "targetId" => created_user["id"],
      "detail" => "Self-serve account created from #{request_ip(req)}"
    )
    json_response(res, created_user, 201)
  rescue RateLimitError => e
    store.add_audit_log(
      "actorEmail" => payload && payload["email"].to_s.strip.downcase,
      "actorRole" => "guest",
      "action" => "auth.signup_rate_limited",
      "targetType" => "signup",
      "targetId" => request_ip(req),
      "detail" => "Signup temporarily rate limited from #{request_ip(req)} for #{e.retry_after} seconds"
    ) rescue nil
    rate_limit_response(res, e)
  rescue StandardError => e
    json_response(res, { "error" => e.message }, 422)
  end
end

server.mount_proc "/api/users" do |req, res|
  next if handle_preflight(req, res)
  begin
    require_role!(req, store, "admin")
    json_response(res, store.users.map { |user| store.send(:sanitize_user, user) })
  rescue StandardError => e
    json_response(res, { "error" => e.message }, 403)
  end
end

server.mount_proc "/api/account/orders" do |req, res|
  next if handle_preflight(req, res)
  begin
    user = require_role!(req, store, "customer", "admin")
    email = user["role"] == "admin" ? req.query["email"].to_s : user["email"].to_s
    json_response(res, store.customer_orders(email))
  rescue StandardError => e
    json_response(res, { "error" => e.message }, 403)
  end
end

server.mount_proc "/api/account" do |req, res|
  next if handle_preflight(req, res)
  begin
    user = require_role!(req, store, "customer", "restaurant", "admin")
    if req.request_method == "GET"
      json_response(res, store.send(:sanitize_user, store.user(user["id"]) || user))
      next
    end

    if req.request_method == "PUT"
      payload = parse_json_body(req)
      json_response(res, store.update_user_profile(user["id"], payload))
      next
    end

    json_response(res, { "error" => "Method not allowed" }, 405)
  rescue StandardError => e
    json_response(res, { "error" => e.message }, 422)
  end
end

server.mount_proc "/api/account/password" do |req, res|
  next if handle_preflight(req, res)
  begin
    unless req.request_method == "PUT"
      json_response(res, { "error" => "Method not allowed" }, 405)
      next
    end

    user = require_role!(req, store, "customer", "restaurant", "admin")
    rate_limiter.consume!(rate_limit_key("password", req, user["id"]), limit: PASSWORD_RATE_LIMIT["limit"], window: PASSWORD_RATE_LIMIT["window"])
    payload = parse_json_body(req)
    updated = store.update_user_password(user["id"], payload["currentPassword"], payload["newPassword"])
    rate_limiter.reset!(rate_limit_key("password", req, user["id"]))
    store.add_audit_log(
      "actorEmail" => updated["email"],
      "actorRole" => updated["role"],
      "action" => "auth.password_changed",
      "targetType" => "user",
      "targetId" => updated["id"],
      "detail" => "Password changed from #{request_ip(req)}"
    )
    json_response(res, { "ok" => true, "user" => updated })
  rescue RateLimitError => e
    begin
      current = current_user(req, store)
      store.add_audit_log(
        "actorEmail" => current && current["email"],
        "actorRole" => current && current["role"] || "authenticated",
        "action" => "auth.password_rate_limited",
        "targetType" => "user",
        "targetId" => current && current["id"],
        "detail" => "Password change temporarily rate limited from #{request_ip(req)} for #{e.retry_after} seconds"
      )
    rescue StandardError
    end
    rate_limit_response(res, e)
  rescue StandardError => e
    json_response(res, { "error" => e.message }, 422)
  end
end

server.mount_proc "/api/account/notifications" do |req, res|
  next if handle_preflight(req, res)
  begin
    user = require_role!(req, store, "customer", "restaurant", "admin")
    json_response(res, store.notifications_for_email(user["email"]))
  rescue StandardError => e
    json_response(res, { "error" => e.message }, 403)
  end
end

server.mount_proc "/api/account/sessions" do |req, res|
  next if handle_preflight(req, res)
  path_parts = req.path.split("/").reject(&:empty?)

  begin
    user = require_role!(req, store, "customer", "restaurant", "admin")
    token = auth_token(req)

    if req.request_method == "GET" && path_parts.length == 3
      json_response(res, {
        "sessions" => store.sessions_for_user(user["id"], token),
        "currentTokenPresent" => !token.to_s.empty?
      })
      next
    end

    if req.request_method == "POST" && path_parts.length == 4 && path_parts[3] == "revoke-others"
      result = store.delete_other_sessions(user["id"], token)
      store.add_audit_log(
        "actorEmail" => user["email"],
        "actorRole" => user["role"],
        "action" => "account.sessions_revoked",
        "targetType" => "user",
        "targetId" => user["id"],
        "detail" => "Revoked #{result['removed']} other active session(s)"
      )
      json_response(res, result)
      next
    end

    if req.request_method == "POST" && path_parts.length == 5 && path_parts[4] == "revoke"
      session_id = path_parts[3]
      target_session = store.sessions_for_user(user["id"], token).find { |item| item["id"] == session_id }
      raise "Session not found" unless target_session
      result = store.delete_session_by_id(user["id"], session_id)
      store.add_audit_log(
        "actorEmail" => user["email"],
        "actorRole" => user["role"],
        "action" => "account.session_revoked",
        "targetType" => "session",
        "targetId" => session_id,
        "detail" => target_session["isCurrent"] ? "Revoked current session" : "Revoked another active session"
      )
      json_response(res, result)
      next
    end

    json_response(res, { "error" => "Not found" }, 404)
  rescue StandardError => e
    json_response(res, { "error" => e.message }, 422)
  end
end

server.mount_proc "/api/reviews" do |req, res|
  next if handle_preflight(req, res)
  begin
    if req.request_method == "GET"
      restaurant_slug = req.query["restaurantSlug"].to_s
      if restaurant_slug.empty?
        user = require_role!(req, store, "customer", "admin")
        reviews = user["role"] == "customer" ? store.reviews_for_user(user["email"]) : store.reviews
        json_response(res, reviews)
      else
        json_response(res, store.reviews_for_restaurant(restaurant_slug))
      end
      next
    end

    if req.request_method == "POST"
      user = require_role!(req, store, "customer")
      payload = parse_json_body(req)
      review = store.add_review(user, payload)
      json_response(res, review, 201)
      next
    end

    json_response(res, { "error" => "Method not allowed" }, 405)
  rescue StandardError => e
    json_response(res, { "error" => e.message }, 422)
  end
end

server.mount_proc "/api/favorites" do |req, res|
  next if handle_preflight(req, res)
  begin
    user = require_role!(req, store, "customer")
    if req.request_method == "GET"
      json_response(res, store.favorites_for_user(user))
      next
    end

    if req.request_method == "POST"
      payload = parse_json_body(req)
      result = store.toggle_favorite(user["id"], payload["restaurantSlug"].to_s)
      json_response(res, result)
      next
    end

    json_response(res, { "error" => "Method not allowed" }, 405)
  rescue StandardError => e
    json_response(res, { "error" => e.message }, 422)
  end
end

server.mount_proc "/api/saved-searches" do |req, res|
  next if handle_preflight(req, res)
  path_parts = req.path.split("/").reject(&:empty?)
  begin
    user = require_role!(req, store, "customer")

    if req.request_method == "GET"
      json_response(res, store.saved_searches_for_user(user))
      next
    end

    if req.request_method == "POST" && path_parts.length == 2
      payload = parse_json_body(req)
      json_response(res, store.add_saved_search(user["id"], payload), 201)
      next
    end

    if req.request_method == "DELETE" && path_parts.length == 3
      json_response(res, store.delete_saved_search(user["id"], path_parts.last))
      next
    end

    json_response(res, { "error" => "Not found" }, 404)
  rescue StandardError => e
    json_response(res, { "error" => e.message }, 422)
  end
end

server.mount_proc "/api/issues" do |req, res|
  next if handle_preflight(req, res)
  path_parts = req.path.split("/").reject(&:empty?)

  if req.request_method == "GET"
    begin
      user = require_role!(req, store, "customer", "restaurant", "admin")
      json_response(res, store.issues_for_user(user))
    rescue StandardError => e
      json_response(res, { "error" => e.message }, 403)
    end
    next
  end

  if req.request_method == "POST"
    begin
      user = require_role!(req, store, "customer", "restaurant", "admin")
      payload = parse_json_body(req)
      issue_text = payload["issue"].to_s.strip
      order_id = payload["order"].to_s.strip
      raise "Issue description is required" if issue_text.empty?
      raise "Order is required" if order_id.empty?

      order = store.visible_order_for_user(user, order_id)
      raise "Order not found" unless order

      issue = store.add_issue(
        "id" => store.next_issue_id,
        "order" => order_id,
        "issue" => issue_text,
        "owner" => user["role"] == "admin" ? "Ops team" : "Support",
        "priority" => payload["priority"].to_s.empty? ? "Medium" : payload["priority"].to_s,
        "status" => "Open",
        "createdByEmail" => user["email"],
        "createdByRole" => user["role"],
        "createdAt" => Time.now.utc.iso8601,
        "updatedAt" => Time.now.utc.iso8601
      )

      store.add_notification(
        "id" => store.next_notification_id,
        "userEmail" => order["customerEmail"],
        "title" => "Support ticket created",
        "body" => "#{issue['id']} was opened for order #{order['id']}.",
        "entityType" => "issue",
        "entityId" => issue["id"],
        "orderId" => order["id"],
        "createdAt" => Time.now.utc.iso8601
      ) unless order["customerEmail"].to_s.empty?

      json_response(res, issue, 201)
    rescue StandardError => e
      json_response(res, { "error" => e.message }, 422)
    end
    next
  end

  if req.request_method == "PUT" && path_parts.length == 3
    begin
      require_role!(req, store, "admin")
      payload = parse_json_body(req)
      issue = store.update_issue(path_parts.last, payload)
      json_response(res, issue)
    rescue StandardError => e
      json_response(res, { "error" => e.message }, 422)
    end
    next
  end

  json_response(res, { "error" => "Not found" }, 404)
end

server.mount_proc "/api/dashboard/restaurant" do |req, res|
  next if handle_preflight(req, res)
  json_response(res, GatherTrayMetrics.restaurant_dashboard(store, req.query["slug"]))
end

server.mount_proc "/api/dashboard/admin" do |req, res|
  next if handle_preflight(req, res)
  json_response(res, GatherTrayMetrics.admin_dashboard(store))
end

server.mount_proc "/api/restaurant-applications" do |req, res|
  next if handle_preflight(req, res)
  path_parts = req.path.split("/").reject(&:empty?)

  if req.request_method == "GET" && path_parts.length == 3 && path_parts[2] == "status"
    begin
      email = req.query["email"].to_s.strip.downcase
      raise "Email is required" if email.empty?
      applications = store.applications
        .select { |item| item["email"].to_s.downcase == email }
        .sort_by { |item| item["submittedAt"].to_s }
        .reverse
      json_response(res, applications)
    rescue StandardError => e
      json_response(res, { "error" => e.message }, 422)
    end
    next
  end

  if req.request_method == "GET" && path_parts.length == 2
    json_response(res, store.applications)
    next
  end

  if req.request_method == "POST" && path_parts.length == 2
    begin
      payload = JSON.parse(req.body)
      packages = Array(payload["packages"]).map do |pkg|
        {
          "name" => pkg["name"].to_s.strip,
          "price" => pkg["price"].to_f.round(2),
          "serves" => pkg["serves"].to_s.strip
        }
      end.reject { |pkg| pkg["name"].empty? }

      documents = Array(payload["documents"]).map do |doc|
        {
          "label" => doc["label"].to_s,
          "name" => doc["name"].to_s,
          "type" => doc["type"].to_s,
          "size" => doc["size"].to_i,
          "content" => doc["content"].to_s
        }
      end.reject { |doc| doc["name"].empty? }

      application = {
        "id" => store.next_application_id,
        "status" => "pending",
        "businessName" => payload["businessName"].to_s.strip,
        "ownerName" => payload["ownerName"].to_s.strip,
        "email" => payload["email"].to_s.strip,
        "phone" => payload["phone"].to_s.strip,
        "website" => normalize_restaurant_website(payload["website"]),
        "cuisine" => payload["cuisine"].to_s.strip,
        "city" => payload["city"].to_s.strip,
        "deliveryRadius" => payload["deliveryRadius"].to_s.strip,
        "minimumOrder" => payload["minimumOrder"].to_f.round(2),
        "description" => payload["description"].to_s.strip,
        "packages" => packages,
        "documents" => documents,
        "reviewNote" => "",
        "importStatusNote" => "",
        "importedPackageCount" => 0,
        "submittedAt" => Time.now.utc.iso8601
      }

      required_fields = %w[businessName ownerName email cuisine city description]
      missing = required_fields.select { |field| application[field].to_s.empty? }
      raise "Missing required fields: #{missing.join(', ')}" unless missing.empty?
      raise "Add at least one menu package" if packages.empty?
      raise "Upload at least one required document" if documents.empty?

      store.add_application(application)
      store.queue_email(
        "to" => application["email"],
        "subject" => "GatherTray application received",
        "body" => "Your restaurant application #{application['id']} has been received and is pending review.",
        "createdAt" => Time.now.utc.iso8601
      )
      json_response(res, application, 201)
    rescue StandardError => e
      json_response(res, { "error" => e.message }, 422)
    end
    next
  end

  if req.request_method == "POST" && path_parts.length == 4 && path_parts[3] == "approve"
    begin
      user = require_role!(req, store, "admin")
      result = store.approve_application(path_parts[2])
      import_message = nil
      website = result.dig("restaurant", "website").to_s
      unless website.empty?
        begin
          html = fetch_remote_html(website)
          packages = extract_menu_packages_from_html(html)
          imported_at = Time.now.utc.iso8601
          if packages.empty?
            updated_restaurant = store.update_restaurant(result["restaurant"]["slug"], {
              "menuImportSource" => website,
              "menuImportNote" => "Website saved during approval, but no priced menu lines were detected for automatic import.",
              "menuImportedAt" => imported_at,
              "menuImportCount" => 0
            })
            result["restaurant"] = store.restaurant_summary(updated_restaurant)
            import_message = "Website saved, but no priced menu lines were detected for automatic import."
          else
            updated_restaurant = store.update_restaurant(result["restaurant"]["slug"], {
              "packages" => packages,
              "perPerson" => packages.map { |pkg| pkg["price"].to_f }.min || result["restaurant"]["perPerson"].to_f,
              "menuImportSource" => website,
              "menuImportNote" => "Imported #{packages.length} package(s) automatically during approval. Restaurants can still edit pricing in the portal.",
              "menuImportedAt" => imported_at,
              "menuImportCount" => packages.length
            })
            result["restaurant"] = store.restaurant_summary(updated_restaurant)
            import_message = "Imported #{packages.length} package(s) automatically from the restaurant website during approval."
          end
        rescue StandardError => e
          updated_restaurant = store.update_restaurant(result["restaurant"]["slug"], {
            "menuImportSource" => website,
            "menuImportNote" => "Website saved during approval, but automatic import needs review: #{e.message}",
            "menuImportedAt" => Time.now.utc.iso8601,
            "menuImportCount" => 0
          })
          result["restaurant"] = store.restaurant_summary(updated_restaurant)
          import_message = "Website saved, but automatic import needs review: #{e.message}"
        end
      end

      store.add_notification(
        "id" => store.next_notification_id,
        "userEmail" => result["restaurant"]["contactEmail"],
        "title" => "Restaurant application approved",
        "body" => "#{result['restaurant']['name']} has been approved and can now be managed inside GatherTray.#{import_message ? " #{import_message}" : ""}",
        "entityType" => "application",
        "entityId" => path_parts[2],
        "createdAt" => Time.now.utc.iso8601
      )
      store.queue_email(
        "to" => result["restaurant"]["contactEmail"],
        "subject" => "GatherTray application approved",
        "body" => "#{result['restaurant']['name']} has been approved and can now be managed inside GatherTray.#{import_message ? " #{import_message}" : ""}",
        "createdAt" => Time.now.utc.iso8601
      )
      updated_application = store.update_application_metadata(path_parts[2], {
        "importStatusNote" => import_message.to_s,
        "importedPackageCount" => result.dig("restaurant", "menuImportCount").to_i
      })
      store.add_audit_log(
        "actorEmail" => user["email"],
        "actorRole" => user["role"],
        "action" => "application.approved",
        "targetType" => "application",
        "targetId" => path_parts[2],
        "detail" => import_message.to_s.empty? ? "Restaurant application approved" : "Restaurant application approved. #{import_message}"
      )
      result["application"] = updated_application
      result["importMessage"] = import_message unless import_message.to_s.empty?
      json_response(res, result)
    rescue StandardError => e
      json_response(res, { "error" => e.message }, 422)
    end
    next
  end

  if req.request_method == "POST" && path_parts.length == 4 && path_parts[3] == "reject"
    begin
      user = require_role!(req, store, "admin")
      payload = parse_json_body(req)
      application = store.reject_application(path_parts[2], payload["reason"])
      store.add_audit_log(
        "actorEmail" => user["email"],
        "actorRole" => user["role"],
        "action" => "application.rejected",
        "targetType" => "application",
        "targetId" => application["id"],
        "detail" => "Rejected application. Reason: #{application['rejectionReason']}"
      )
      store.add_notification(
        "id" => store.next_notification_id,
        "userEmail" => application["email"],
        "title" => "Restaurant application update",
        "body" => "Your application #{application['id']} was not approved. Reason: #{application['rejectionReason']}",
        "entityType" => "application",
        "entityId" => application["id"],
        "createdAt" => Time.now.utc.iso8601
      )
      store.queue_email(
        "to" => application["email"],
        "subject" => "GatherTray application update",
        "body" => "Your application #{application['id']} was not approved. Reason: #{application['rejectionReason']}",
        "createdAt" => Time.now.utc.iso8601
      )
      json_response(res, application)
    rescue StandardError => e
      json_response(res, { "error" => e.message }, 422)
    end
    next
  end

  if req.request_method == "POST" && path_parts.length == 4 && path_parts[3] == "request-changes"
    begin
      user = require_role!(req, store, "admin")
      payload = parse_json_body(req)
      application = store.request_application_changes(path_parts[2], payload["note"])
      store.add_audit_log(
        "actorEmail" => user["email"],
        "actorRole" => user["role"],
        "action" => "application.changes_requested",
        "targetType" => "application",
        "targetId" => application["id"],
        "detail" => "Requested application changes. Note: #{application['reviewNote']}"
      )
      store.add_notification(
        "id" => store.next_notification_id,
        "userEmail" => application["email"],
        "title" => "Restaurant application needs updates",
        "body" => "Your application #{application['id']} needs changes before approval. Note: #{application['reviewNote']}",
        "entityType" => "application",
        "entityId" => application["id"],
        "createdAt" => Time.now.utc.iso8601
      )
      store.queue_email(
        "to" => application["email"],
        "subject" => "GatherTray application needs updates",
        "body" => "Your application #{application['id']} needs changes before approval. Note: #{application['reviewNote']}",
        "createdAt" => Time.now.utc.iso8601
      )
      json_response(res, application)
    rescue StandardError => e
      json_response(res, { "error" => e.message }, 422)
    end
    next
  end

  json_response(res, { "error" => "Not found" }, 404)
end

server.start
