const nodemailer = require('nodemailer');

// Create transporter (mock in dev, real SMTP in production)
function getTransporter() {
  if (process.env.NODE_ENV === 'production' && process.env.SMTP_HOST) {
    return nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: parseInt(process.env.SMTP_PORT || '587'),
      secure: false,
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS
      }
    });
  }

  // Dev/test: log to console
  return {
    sendMail: async (options) => {
      console.log('\n=== EMAIL (DEV MODE) ===');
      console.log('To:', options.to);
      console.log('Subject:', options.subject);
      console.log('Link:', options.html?.match(/href="([^"]+)"/)?.[1] || 'N/A');
      console.log('========================\n');
      return { messageId: `dev-${Date.now()}` };
    }
  };
}

const emailTemplates = {
  de: {
    subject: 'Personalfragebogen - Bitte ausfüllen',
    greeting: (name) => `Sehr geehrte/r ${name || 'Bewerber/in'}`,
    body: 'wir freuen uns, Sie in unserem Team begrüßen zu dürfen! Bitte füllen Sie den folgenden Personalfragebogen vollständig aus:',
    button: 'Fragebogen ausfüllen',
    footer: 'Bei Fragen wenden Sie sich bitte an unsere Personalabteilung.'
  },
  en: {
    subject: 'Personnel Questionnaire - Please complete',
    greeting: (name) => `Dear ${name || 'Applicant'}`,
    body: 'we are pleased to welcome you to our team! Please complete the following personnel questionnaire:',
    button: 'Fill out questionnaire',
    footer: 'If you have any questions, please contact our HR department.'
  },
  bg: {
    subject: 'Въпросник за персонала - Моля попълнете',
    greeting: (name) => `Уважаеми/а ${name || 'Кандидат'}`,
    body: 'радваме се да ви приветстваме в нашия екип! Моля попълнете следния въпросник за персонала:',
    button: 'Попълнете въпросника',
    footer: 'Ако имате въпроси, моля свържете се с нашия отдел Човешки ресурси.'
  },
  tr: {
    subject: 'Personel Anketi - Lütfen doldurun',
    greeting: (name) => `Sayın ${name || 'Başvuran'}`,
    body: 'sizi ekibimize katılmanızdan mutluluk duyuyoruz! Lütfen aşağıdaki personel anketini doldurun:',
    button: 'Anketi doldurun',
    footer: 'Sorularınız için lütfen İnsan Kaynakları departmanımızla iletişime geçin.'
  },
  fa: {
    subject: 'پرسشنامه پرسنلی - لطفا تکمیل کنید',
    greeting: (name) => `${name || 'متقاضی'} عزیز`,
    body: 'ما خوشحالیم که شما را در تیم خود می‌پذیریم! لطفا پرسشنامه پرسنلی زیر را تکمیل کنید:',
    button: 'پرسشنامه را پر کنید',
    footer: 'در صورت داشتن سوال، لطفا با بخش منابع انسانی ما تماس بگیرید.'
  },
  hr: {
    subject: 'Upitnik za osoblje - Molimo ispunite',
    greeting: (name) => `Poštovani/a ${name || 'Kandidat/kinja'}`,
    body: 'drago nam je što ćemo vas pozdraviti u našem timu! Molimo ispunite sljedeći upitnik za osoblje:',
    button: 'Ispunite upitnik',
    footer: 'Ako imate pitanja, obratite se našem odjelu za ljudske resurse.'
  }
};

async function sendQuestionnaireEmail(to, firstName, questionnaireUrl, language = 'de') {
  const template = emailTemplates[language] || emailTemplates.de;
  const transporter = getTransporter();

  const html = `
    <!DOCTYPE html>
    <html dir="${language === 'fa' ? 'rtl' : 'ltr'}">
    <head><meta charset="utf-8"></head>
    <body style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
      <div style="background: #1a365d; color: white; padding: 20px; border-radius: 8px 8px 0 0;">
        <h1 style="margin: 0; font-size: 24px;">ORNC HR Portal</h1>
      </div>
      <div style="border: 1px solid #e2e8f0; padding: 30px; border-radius: 0 0 8px 8px;">
        <p style="font-size: 16px;">${template.greeting(firstName)},</p>
        <p style="font-size: 14px; color: #4a5568;">${template.body}</p>
        <div style="text-align: center; margin: 30px 0;">
          <a href="${questionnaireUrl}"
             style="background: #2b6cb0; color: white; padding: 14px 28px; text-decoration: none;
                    border-radius: 6px; font-size: 16px; font-weight: bold;">
            ${template.button}
          </a>
        </div>
        <p style="font-size: 12px; color: #718096;">${template.footer}</p>
        <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 20px 0;">
        <p style="font-size: 11px; color: #a0aec0;">
          Link: <a href="${questionnaireUrl}">${questionnaireUrl}</a>
        </p>
      </div>
    </body>
    </html>
  `;

  return transporter.sendMail({
    from: process.env.SMTP_FROM || 'HR Portal <hr@ornc.de>',
    to,
    subject: template.subject,
    html
  });
}

module.exports = { sendQuestionnaireEmail };
