'use strict';

const form = document.getElementById('booking-form');
const success = document.getElementById('form-success');

form.addEventListener('submit', function (e) {
  e.preventDefault();

  const data = {
    name: form.elements['name'].value,
    email: form.elements['email'].value,
    event_type: form.elements['event_type'].value,
    date: form.elements['date'].value,
    location: form.elements['location'].value,
    headcount: form.elements['headcount'].value,
    about: form.elements['about'].value,
  };

  console.log('Booking inquiry:', data);

  form.style.display = 'none';
  success.classList.remove('hidden');
});
