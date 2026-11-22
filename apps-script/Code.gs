// Lab Hours Log mailer. Deploy as a Web app: Execute as "Me", Access "Anyone".
// Set Script property SECRET (Project Settings > Script properties).
function doPost(e) {
  try {
    var d = JSON.parse(e.postData.contents);
    var secret = PropertiesService.getScriptProperties().getProperty("SECRET");
    if (!secret || d.secret !== secret) return ContentService.createTextOutput("denied");
    if (!d.to || !d.subject || !d.html) return ContentService.createTextOutput("bad request");
    MailApp.sendEmail({ to: d.to, subject: d.subject, htmlBody: d.html, name: "Lab Hours Log" });
    return ContentService.createTextOutput("ok");
  } catch (err) {
    return ContentService.createTextOutput("error " + err);
  }
}
