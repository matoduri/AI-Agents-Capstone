// -------------------------------------------------------------
// Session ID Handling
// -------------------------------------------------------------
function generateUUID() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
        var r = Math.random() * 16 | 0, v = c == 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}

function formatDateToDMY(dateStr) {
    if (!dateStr) return "";
    const parts = dateStr.split('-');
    if (parts.length === 3) {
        return `${parts[2]}.${parts[1]}.${parts[0]}`;
    }
    return dateStr;
}


// -------------------------------------------------------------
// Image Cropper Utility
// -------------------------------------------------------------
let currentCropper = null;

function openCropModal(file, onSaveCallback, onCancelCallback) {
    const cropModal = document.getElementById('cropModal');
    const imageToCrop = document.getElementById('imageToCrop');
    const saveCropBtn = document.getElementById('saveCropBtn');
    const cancelCropBtn = document.getElementById('cancelCropBtn');
    const closeCropModalBtn = document.getElementById('closeCropModalBtn');

    const reader = new FileReader();
    reader.onload = function(e) {
        imageToCrop.src = e.target.result;
        cropModal.style.display = 'flex';

        if (currentCropper) {
            currentCropper.destroy();
        }

        // Initialize Cropper.js
        currentCropper = new Cropper(imageToCrop, {
            aspectRatio: 1, // Enforce 1:1 square crop box
            viewMode: 1, // Restrict the crop box to not exceed the size of the canvas
            dragMode: 'move', // Allow moving the image inside the crop area
            autoCropArea: 1.0, // Make the crop box match full available width/height
            restore: false,
            guides: false,
            center: true,
            highlight: false,
            cropBoxMovable: true,
            cropBoxResizable: true,
            toggleDragModeOnDblclick: false,
        });
    };
    reader.readAsDataURL(file);

    // Remove old listeners to avoid multiple attachments
    const newSaveBtn = saveCropBtn.cloneNode(true);
    const newCancelBtn = cancelCropBtn.cloneNode(true);
    const newCloseBtn = closeCropModalBtn.cloneNode(true);
    
    saveCropBtn.parentNode.replaceChild(newSaveBtn, saveCropBtn);
    cancelCropBtn.parentNode.replaceChild(newCancelBtn, cancelCropBtn);
    closeCropModalBtn.parentNode.replaceChild(newCloseBtn, closeCropModalBtn);

    newSaveBtn.addEventListener('click', () => {
        if (!currentCropper) return;
        // Output 256x256 image for size/performance optimization
        const canvas = currentCropper.getCroppedCanvas({
            width: 256,
            height: 256,
            imageSmoothingEnabled: true,
            imageSmoothingQuality: 'high',
        });
        const croppedBase64 = canvas.toDataURL('image/jpeg', 0.9);
        
        currentCropper.destroy();
        currentCropper = null;
        cropModal.style.display = 'none';
        if (onSaveCallback) onSaveCallback(croppedBase64);
    });

    const closeHandler = () => {
        if (currentCropper) {
            currentCropper.destroy();
            currentCropper = null;
        }
        cropModal.style.display = 'none';
        if (onCancelCallback) onCancelCallback();
    };

    newCancelBtn.addEventListener('click', closeHandler);
    newCloseBtn.addEventListener('click', closeHandler);
}

let sessionId = localStorage.getItem('newborn_tracker_session_id');
if (!sessionId) {
    sessionId = generateUUID();
    localStorage.setItem('newborn_tracker_session_id', sessionId);
}

// Active state variables
let activeNewbornName = "";
let currentInterruptId = null;
let globalTrackerState = null;
let currentUnitSystem = localStorage.getItem('newborn_tracker_unit_system') || 'imperial';
let currentRange = localStorage.getItem('newborn_tracker_range') || '7';
let initialWelcomeDone = false;

// Chart instances
let weightChartInst = null;
let feedCountChartInst = null;
let feedAmountChartInst = null;
let diaperChartInst = null;

const chatMessages = document.getElementById('chatMessages');
const chatForm = document.getElementById('chatForm');
const chatInput = document.getElementById('chatInput');
const hitlContainer = document.getElementById('hitlContainer');
const newbornSelect = document.getElementById('newbornSelect');
const unitImperialBtn = document.getElementById('unitImperialBtn');
const unitMetricBtn = document.getElementById('unitMetricBtn');
// Set up Range Selector Shortcuts and Custom Calendar controls
const rangeTriggerBtn = document.getElementById('rangeTriggerBtn');
const rangeTriggerLabel = document.getElementById('rangeTriggerLabel');
const rangeDropdownPanel = document.getElementById('rangeDropdownPanel');
const rangeShortcuts = document.getElementById('rangeShortcuts');
const customRangeToggleBtn = document.getElementById('customRangeToggleBtn');
const customDateRangePicker = document.getElementById('customDateRangePicker');
const customStartDate = document.getElementById('customStartDate');
const customEndDate = document.getElementById('customEndDate');

function formatPrettyDate(dateStr) {
    if (!dateStr) return "";
    const [year, month, day] = dateStr.split('-');
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return `${months[parseInt(month) - 1]} ${parseInt(day)}, ${year}`;
}

function updateRangeTriggerLabelText() {
    if (!rangeTriggerLabel) return;
    if (currentRange === 'custom') {
        const start = customStartDate.value;
        const end = customEndDate.value;
        if (start && end) {
            rangeTriggerLabel.innerText = `${formatPrettyDate(start)} - ${formatPrettyDate(end)}`;
        } else {
            rangeTriggerLabel.innerText = "Custom Range";
        }
    } else {
        const labels = {
            '3': '3 Days',
            '7': '7 Days',
            '30': 'Month',
            '180': '6 Months',
            '365': '12 Months',
            'all': 'All Time'
        };
        rangeTriggerLabel.innerText = labels[currentRange] || '7 Days';
    }
}

if (rangeTriggerBtn) {
    rangeTriggerBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const isOpen = rangeDropdownPanel.style.display === 'flex';
        rangeDropdownPanel.style.display = isOpen ? 'none' : 'flex';
    });
}

document.addEventListener('click', (e) => {
    if (rangeDropdownPanel && !rangeDropdownPanel.contains(e.target) && e.target !== rangeTriggerBtn && !rangeTriggerBtn.contains(e.target)) {
        rangeDropdownPanel.style.display = 'none';
    }
});

if (rangeShortcuts) {
    const btns = rangeShortcuts.querySelectorAll('button');
    btns.forEach(btn => {
        const val = btn.getAttribute('data-range');
        if (val === currentRange) {
            btn.classList.add('active');
        } else {
            btn.classList.remove('active');
        }
    });

    if (currentRange === 'custom') {
        customDateRangePicker.style.display = 'flex';
        if (customRangeToggleBtn) customRangeToggleBtn.classList.add('active');
    }
    updateRangeTriggerLabelText();
}

const onCustomDateChange = () => {
    updateRangeTriggerLabelText();
    if (globalTrackerState && activeNewbornName) {
        updateCharts(globalTrackerState.newborns[activeNewbornName]);
    }
};
if (customStartDate) customStartDate.addEventListener('change', onCustomDateChange);
if (customEndDate) customEndDate.addEventListener('change', onCustomDateChange);

if (rangeShortcuts) {
    rangeShortcuts.addEventListener('click', (e) => {
        const btn = e.target.closest('button');
        if (!btn) return;

        const val = btn.getAttribute('data-range');
        if (!val) return;

        rangeShortcuts.querySelectorAll('button').forEach(b => b.classList.remove('active'));
        if (customRangeToggleBtn) customRangeToggleBtn.classList.remove('active');
        btn.classList.add('active');
        customDateRangePicker.style.display = 'none';

        currentRange = val;
        localStorage.setItem('newborn_tracker_range', currentRange);
        updateRangeTriggerLabelText();

        if (rangeDropdownPanel) rangeDropdownPanel.style.display = 'none';

        if (globalTrackerState && activeNewbornName) {
            updateCharts(globalTrackerState.newborns[activeNewbornName]);
        }
    });
}

if (customRangeToggleBtn) {
    customRangeToggleBtn.addEventListener('click', () => {
        rangeShortcuts.querySelectorAll('button').forEach(b => b.classList.remove('active'));
        customRangeToggleBtn.classList.add('active');
        customDateRangePicker.style.display = 'flex';

        currentRange = 'custom';
        localStorage.setItem('newborn_tracker_range', 'custom');

        if (!customStartDate.value || !customEndDate.value) {
            const end = new Date();
            const start = new Date();
            start.setDate(end.getDate() - 6);
            customStartDate.value = start.toISOString().split('T')[0];
            customEndDate.value = end.toISOString().split('T')[0];
        }
        updateRangeTriggerLabelText();

        if (globalTrackerState && activeNewbornName) {
            updateCharts(globalTrackerState.newborns[activeNewbornName]);
        }
    });
}

// Helpers for Unit Conversion
function getWeightValue(weightStr, system) {
    const lbs = parseWeightToLbs(weightStr);
    if (system === 'metric') {
        return lbs * 0.45359237; // lbs to kg
    }
    return lbs;
}

function formatWeight(weightStr, system) {
    if (!weightStr) return "--";
    const lbs = parseWeightToLbs(weightStr);
    if (system === 'metric') {
        const kg = lbs * 0.45359237;
        return kg.toFixed(2) + " kg";
    } else {
        const totalOz = Math.round(lbs * 16);
        const l = Math.floor(totalOz / 16);
        const o = totalOz % 16;
        return `${l} lbs ${o} oz`;
    }
}

function getFeedAmountValue(amountOz, system) {
    if (!amountOz) return 0;
    if (system === 'metric') {
        return amountOz * 29.5735; // oz to ml
    }
    return amountOz;
}

function formatFeedAmount(amountOz, system) {
    if (!amountOz) return "--";
    if (system === 'metric') {
        return Math.round(amountOz * 29.5735) + " ml";
    }
    return amountOz.toFixed(1) + " oz";
}

function updateBabyHeader(nb) {
    const photoContainer = document.getElementById('babyPhotoContainer');
    const photoImg = document.getElementById('babyPhotoImg');
    const photoPlaceholder = document.getElementById('babyPhotoPlaceholder');
    const photoOverlay = document.getElementById('babyPhotoOverlay');
    const removePhotoLink = document.getElementById('removePhotoLink');
    const deleteBtn = document.getElementById('deleteBabyBtn');

    if (!nb) {
        document.getElementById('currentBabyTitle').innerText = "No Baby Selected";
        document.getElementById('babySubtitle').innerText = "Create a newborn profile in the chat to start plotting stats";
        document.getElementById('devFactCard').style.display = 'none';
        if (photoContainer) photoContainer.style.display = 'none';
        if (deleteBtn) deleteBtn.style.display = 'none';
        if (removePhotoLink) removePhotoLink.style.display = 'none';
        return;
    }
    
    if (photoContainer) photoContainer.style.display = 'block';
    if (deleteBtn) deleteBtn.style.display = 'inline-flex';

    if (nb.profile.photo_base64) {
        photoImg.src = nb.profile.photo_base64;
        photoImg.style.display = 'block';
        photoPlaceholder.style.display = 'none';
        if (photoOverlay) photoOverlay.style.display = 'flex';
        if (removePhotoLink) removePhotoLink.style.display = 'inline-block';
    } else {
        photoImg.style.display = 'none';
        photoPlaceholder.style.display = 'flex';
        if (photoOverlay) photoOverlay.style.display = 'none';
        if (removePhotoLink) removePhotoLink.style.display = 'none';
    }

    let ageText = "";
    if (nb.profile.birth_date) {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const bday = new Date(nb.profile.birth_date + 'T00:00:00');
        const diffTime = today - bday;
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
        if (diffDays === 0) ageText = " (Newborn)";
        else if (diffDays === 1) ageText = " (1 day old)";
        else ageText = ` (${diffDays} days old)`;
    }
    
    document.getElementById('currentBabyTitle').innerText = nb.profile.name + ageText;
    document.getElementById('babySubtitle').innerText = nb.profile.birth_date ? `Born on ${formatDateToDMY(nb.profile.birth_date)}` : "Birth date not registered";
    
    // Render interesting developmental milestone facts
    updateDevFact(nb);
}

function updateDevFact(nb) {
    const card = document.getElementById('devFactCard');
    if (!nb || !nb.profile.birth_date) {
        card.style.display = 'none';
        return;
    }
    
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const bday = new Date(nb.profile.birth_date + 'T00:00:00');
    const diffTime = today - bday;
    const ageDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    if (ageDays < 0) {
        card.style.display = 'none';
        return;
    }
    
    let ageLabel = "";
    let factText = "";
    let sourceUrl = "";
    let sourceLabel = "";
    
    if (ageDays <= 3) {
        ageLabel = `${ageDays} days`;
        factText = "Newborns are born with a strong grasp reflex. They can grip tight enough to support their own weight briefly, and their vision is limited to about 8 to 10 inches.";
        sourceUrl = "https://www.healthline.com/health/baby/newborn-reflexes";
        sourceLabel = "Healthline - Newborn Reflexes";
    } else if (ageDays <= 7) {
        ageLabel = `${ageDays} days`;
        factText = "At this age, babies are rapidly developing their sense of smell. They can recognize the scent of their mother's milk and the unique sound of their parent's voice.";
        sourceUrl = "https://www.whattoexpect.com/first-year/week-1";
        sourceLabel = "What to Expect - Baby Week 1";
    } else if (ageDays <= 14) {
        ageLabel = `${ageDays} days`;
        factText = "Babies usually regain their initial birth weight around day 10 to 14. They also go through their first major physical growth spurt during this second week!";
        sourceUrl = "https://www.healthychildren.org/English/ages-stages/baby/Pages/default.aspx";
        sourceLabel = "HealthyChildren - First Weeks";
    } else if (ageDays <= 21) {
        ageLabel = `${ageDays} days`;
        factText = "Your baby's hearing is now fully mature! They will begin to startle at loud noises, turn their head towards voices, and focus visual attention on high-contrast items.";
        sourceUrl = "https://www.webmd.com/parenting/baby/baby-development-3-weeks";
        sourceLabel = "WebMD - Baby at 3 Weeks";
    } else if (ageDays <= 30) {
        ageLabel = `${ageDays} days`;
        factText = "By the end of the first month, your baby can briefly lift their head when lying on their tummy and their eyes can track a moving object over a short distance.";
        sourceUrl = "https://www.cdc.gov/ncbddd/actearly/milestones/milestones-2mo.html";
        sourceLabel = "CDC - 2 Month Milestones";
    } else if (ageDays <= 60) {
        const weeks = Math.round(ageDays / 7);
        ageLabel = `${weeks} weeks`;
        factText = "Your baby is starting to vocalize and make sweet gurgling sounds! They might also flash their first real social smile in response to your voice or smile.";
        sourceUrl = "https://www.zerotothree.org/resources/187-baby-milestones-1-to-2-months";
        sourceLabel = "Zero to Three - 1-2 Months";
    } else if (ageDays <= 90) {
        const months = Math.round(ageDays / 30);
        ageLabel = `${months} months`;
        factText = "Babies at this age are strengthening their neck muscles. During tummy time, they can push up on their elbows and hold their head up steady.";
        sourceUrl = "https://www.healthychildren.org/English/ages-stages/baby/Pages/Developmental-Milestones-3-Months.aspx";
        sourceLabel = "HealthyChildren - 3 Months Milestones";
    } else if (ageDays <= 120) {
        ageLabel = "4 months";
        factText = "By 4 months, babies can typically hold their head steady unsupported, push down on their legs when feet are on a flat surface, and begin to roll from tummy to back.";
        sourceUrl = "https://www.cdc.gov/ncbddd/actearly/milestones/milestones-4mo.html";
        sourceLabel = "CDC - 4 Month Milestones";
    } else if (ageDays <= 180) {
        ageLabel = "6 months";
        factText = "At 6 months, babies start showing curiosity about things, bring items to their mouth, begin to sit without support, and may start responding to their own name.";
        sourceUrl = "https://www.cdc.gov/ncbddd/actearly/milestones/milestones-6mo.html";
        sourceLabel = "CDC - 6 Month Milestones";
    } else if (ageDays <= 270) {
        ageLabel = "9 months";
        factText = "By 9 months, babies may cling to familiar adults, have favorite toys, crawl, pull to stand, and understand the word 'no'.";
        sourceUrl = "https://www.cdc.gov/ncbddd/actearly/milestones/milestones-9mo.html";
        sourceLabel = "CDC - 9 Month Milestones";
    } else if (ageDays <= 365) {
        ageLabel = "12 months";
        factText = "At 12 months, babies can usually walk holding onto furniture, say simple words like 'mama' and 'dada', wave 'bye-bye', and find hidden things easily.";
        sourceUrl = "https://www.cdc.gov/ncbddd/actearly/milestones/milestones-12mo.html";
        sourceLabel = "CDC - 12 Month Milestones";
    } else {
        const years = (ageDays / 365.25).toFixed(1);
        ageLabel = `${years} years`;
        factText = "At 1 year or older, children are exploring their environment, walking independently, imitating others, and starting to speak more words.";
        sourceUrl = "https://www.cdc.gov/ncbddd/actearly/milestones/index.html";
        sourceLabel = "CDC - Toddler Milestones";
    }
    
    document.getElementById('devFactAge').innerText = ageLabel;
    document.getElementById('devFactText').innerText = factText;
    const link = document.getElementById('devFactSourceLink');
    link.href = sourceUrl;
    link.innerText = sourceLabel;
    card.style.display = 'flex';
}

// Set initial button active state
if (currentUnitSystem === 'metric') {
    unitMetricBtn.classList.add('active');
    unitImperialBtn.classList.remove('active');
} else {
    unitImperialBtn.classList.add('active');
    unitMetricBtn.classList.remove('active');
}

unitImperialBtn.addEventListener('click', () => {
    currentUnitSystem = 'imperial';
    localStorage.setItem('newborn_tracker_unit_system', 'imperial');
    unitImperialBtn.classList.add('active');
    unitMetricBtn.classList.remove('active');
    updateWizardWeightInputs();
    if (globalTrackerState && activeNewbornName) {
        updateCharts(globalTrackerState.newborns[activeNewbornName]);
    }
});

unitMetricBtn.addEventListener('click', () => {
    currentUnitSystem = 'metric';
    localStorage.setItem('newborn_tracker_unit_system', 'metric');
    unitMetricBtn.classList.add('active');
    unitImperialBtn.classList.remove('active');
    updateWizardWeightInputs();
    if (globalTrackerState && activeNewbornName) {
        updateCharts(globalTrackerState.newborns[activeNewbornName]);
    }
});

const deleteBabyBtn = document.getElementById('deleteBabyBtn');
deleteBabyBtn.addEventListener('click', () => {
    if (!activeNewbornName) return;
    const displayName = globalTrackerState.newborns[activeNewbornName].profile.name;
    if (confirm(`Are you sure you want to delete the profile for ${displayName}? All recorded logs will be permanently lost.`)) {
        fetch(`/api/profiles/${activeNewbornName}`, {
            method: 'DELETE'
        }).then(res => {
            if (res.ok) {
                appendMessage(`Deleted profile for ${displayName}.`, 'system');
                fetchStats();
            } else {
                alert('Failed to delete baby profile');
            }
        }).catch(err => {
            console.error(err);
            alert('Error deleting baby profile');
        });
    }
});

const babyPhotoContainer = document.getElementById('babyPhotoContainer');
const babyPhotoInput = document.getElementById('babyPhotoInput');

babyPhotoContainer.addEventListener('click', () => {
    if (!activeNewbornName) return;
    babyPhotoInput.click();
});

babyPhotoInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    openCropModal(file, (croppedBase64) => {
        fetch(`/api/profiles/${activeNewbornName}/photo`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ photo_base64: croppedBase64 })
        }).then(res => {
            if (res.ok) {
                return res.json();
            } else {
                throw new Error('Failed to update photo');
            }
        }).then(data => {
            if (globalTrackerState && globalTrackerState.newborns[activeNewbornName]) {
                globalTrackerState.newborns[activeNewbornName].profile.photo_base64 = data.photo_url || croppedBase64;
                updateBabyHeader(globalTrackerState.newborns[activeNewbornName]);
            }
        }).catch(err => {
            console.error(err);
            alert('Error updating photo');
        });
    }, () => {
        babyPhotoInput.value = '';
    });
});

const removePhotoLink = document.getElementById('removePhotoLink');
removePhotoLink.addEventListener('click', () => {
    if (!activeNewbornName) return;
    if (confirm("Are you sure you want to remove the baby's photo?")) {
        fetch(`/api/profiles/${activeNewbornName}/photo`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ photo_base64: null })
        }).then(res => {
            if (res.ok) {
                if (globalTrackerState && globalTrackerState.newborns[activeNewbornName]) {
                    globalTrackerState.newborns[activeNewbornName].profile.photo_base64 = null;
                    updateBabyHeader(globalTrackerState.newborns[activeNewbornName]);
                }
            } else {
                alert('Failed to remove photo');
            }
        }).catch(err => {
            console.error(err);
            alert('Error removing photo');
        });
    }
});

function updateWizardWeightInputs() {
    const birthKg = document.getElementById('wizardWeightBirthKg');
    if (!birthKg) return;
    const birthKgLabel = document.getElementById('wizardWeightBirthKgLabel');
    const birthLbs = document.getElementById('wizardWeightBirthLbs');
    const birthOz = document.getElementById('wizardWeightBirthOz');

    const currentKg = document.getElementById('wizardWeightCurrentKg');
    const currentKgLabel = document.getElementById('wizardWeightCurrentKgLabel');
    const currentLbs = document.getElementById('wizardWeightCurrentLbs');
    const currentOz = document.getElementById('wizardWeightCurrentOz');

    const isMetric = currentUnitSystem === 'metric';
    if (isMetric) {
        birthKg.style.display = 'block';
        birthKgLabel.style.display = 'block';
        birthLbs.style.display = 'none';
        birthOz.style.display = 'none';

        currentKg.style.display = 'block';
        currentKgLabel.style.display = 'block';
        currentLbs.style.display = 'none';
        currentOz.style.display = 'none';
    } else {
        birthKg.style.display = 'none';
        birthKgLabel.style.display = 'none';
        birthLbs.style.display = 'block';
        birthOz.style.display = 'block';

        currentKg.style.display = 'none';
        currentKgLabel.style.display = 'none';
        currentLbs.style.display = 'block';
        currentOz.style.display = 'block';
    }
}

// -------------------------------------------------------------
// Main Logic & API Calls
// -------------------------------------------------------------

// Append a message bubble to the chat
function appendMessage(text, role) {
    const msgDiv = document.createElement('div');
    msgDiv.classList.add('message', role);
    msgDiv.innerText = text;
    chatMessages.appendChild(msgDiv);
    chatMessages.scrollTop = chatMessages.scrollHeight;
}

// Add a visual typing loader for when the agent is thinking
function showTypingLoader() {
    const loaderDiv = document.createElement('div');
    loaderDiv.classList.add('message', 'agent', 'typing-message');
    loaderDiv.innerHTML = 'Thinking<div class="typing-loader"><span></span><span></span><span></span></div>';
    chatMessages.appendChild(loaderDiv);
    chatMessages.scrollTop = chatMessages.scrollHeight;
    return loaderDiv;
}

// Submit standard message to runner
async function sendMessage(text, resumeInputData = null) {
    let loader = null;
    if (!resumeInputData) {
        appendMessage(text, 'user');
        loader = showTypingLoader();
    }

    // Build request payload
    const payload = {
        app_name: "app",
        user_id: "default_user",
        session_id: sessionId,
        new_message: {
            role: "user",
            parts: []
        }
    };

    if (resumeInputData) {
        // Resume execution using function_response
        payload.new_message.parts.push({
            function_response: {
                name: "adk_request_input",
                id: resumeInputData.interrupt_id,
                response: {
                    output: resumeInputData.value
                }
            }
        });
    } else {
        payload.new_message.parts.push({
            text: text
        });
    }

    try {
        const response = await fetch('/run', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
            throw new Error('API failure');
        }

        const events = await response.json();
        
        // Remove loader
        if (loader) {
            loader.remove();
        }

        // Parse events
        let gotInterrupt = false;
        
        events.forEach(evt => {
            // Check for standard model content
            if (evt.content && evt.content.parts) {
                evt.content.parts.forEach(part => {
                    if (part.text) {
                        const trimmed = part.text.trim();
                        const isJson = (trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'));
                        if (!isJson) {
                            appendMessage(part.text, 'agent');
                        }
                    }
                });
            }
            
            // Check for interrupt signals (HITL)
            let interruptId = evt.interrupt_id;
            let interruptMessage = evt.message;
            
            if (evt.content && evt.content.parts) {
                evt.content.parts.forEach(part => {
                    if (part.functionCall && part.functionCall.name === 'adk_request_input') {
                        const fc = part.functionCall;
                        if (fc.args) {
                            interruptId = fc.args.interruptId || fc.id;
                            interruptMessage = fc.args.message;
                        }
                    }
                });
            }
            
            if (interruptId) {
                gotInterrupt = true;
                if (interruptId === 'new_baby_wizard') {
                    appendMessage("I've recognized a new child profile. Please fill out a couple of basic details in the setup wizard below to get started.", 'agent');
                }
                renderHITLPrompt(interruptId, interruptMessage);
            }
        });

        if (!gotInterrupt) {
            currentInterruptId = null;
            hitlContainer.innerHTML = '';
        }

        // Re-fetch newborn stats and update graphs
        await fetchStats();

    } catch (err) {
        if (loader) loader.remove();
        appendMessage('Sorry, there was an error communicating with the agent.', 'system');
        console.error(err);
    }
}

// Render human-in-the-loop input panels
function renderHITLPrompt(interruptId, promptMessage) {
    currentInterruptId = interruptId;
    let promptText = promptMessage || "Please reply to complete the query:";

    if (interruptId === 'new_baby_wizard') {
        let wizardPhotoBase64 = null;

        hitlContainer.innerHTML = `
            <div class="hitl-panel newborn-wizard">
                <p><i class="fa-solid fa-baby"></i> <strong>New Baby Setup Wizard</strong></p>
                <div class="wizard-step">
                    <!-- Photo upload block -->
                    <div class="wizard-photo-row" style="display: flex; align-items: center; gap: 16px; margin-bottom: 15px; cursor: pointer;" id="wizardPhotoContainer" title="Click to upload baby photo">
                        <div class="wizard-photo-circle" id="wizardPhotoCircle" style="width: 56px; height: 56px; border-radius: 50%; background: linear-gradient(135deg, #e0e0e0, #bdbdbd); display: flex; align-items: center; justify-content: center; overflow: hidden; position: relative; border: 2.5px dashed #9e9e9e; flex-shrink: 0;">
                            <i class="fa-solid fa-camera" id="wizardPhotoIcon" style="font-size: 18px; color: #757575;"></i>
                            <img id="wizardPhotoPreview" style="display: none; width: 100%; height: 100%; object-fit: cover;">
                        </div>
                        <div style="font-size: 13px; color: var(--color-text-light);">
                            <strong>Baby Photo (Optional)</strong><br>
                            <span id="wizardPhotoText">Click circle to choose image</span>
                            <span id="wizardRemovePhotoLink" style="display: none; color: #ff5252; cursor: pointer; font-weight: 600; margin-top: 4px;" title="Remove baby photo"><i class="fa-solid fa-trash"></i> Remove Photo</span>
                        </div>
                        <input type="file" id="wizardPhotoInput" accept="image/*" style="display: none;">
                    </div>

                    <label for="wizardBirthDate">Date of Birth (DD.MM.YYYY)</label>
                    <input type="text" id="wizardBirthDate" class="hitl-input" placeholder="e.g. 05.07.2026" required pattern="\\d{2}\\.\\d{2}\\.\\d{4}">
                    
                    <label>Weight at Birth</label>
                    <div class="weight-inputs-row">
                        <input type="number" step="0.01" min="0" id="wizardWeightBirthKg" class="hitl-input" placeholder="e.g. 3.4">
                        <span class="unit-label" id="wizardWeightBirthKgLabel">kg</span>
                        <input type="number" min="0" id="wizardWeightBirthLbs" class="hitl-input" placeholder="lbs">
                        <input type="number" min="0" max="15" step="0.1" id="wizardWeightBirthOz" class="hitl-input" placeholder="oz">
                    </div>

                    <label>Current Weight</label>
                    <div class="weight-inputs-row">
                        <input type="number" step="0.01" min="0" id="wizardWeightCurrentKg" class="hitl-input" placeholder="e.g. 3.5">
                        <span class="unit-label" id="wizardWeightCurrentKgLabel">kg</span>
                        <input type="number" min="0" id="wizardWeightCurrentLbs" class="hitl-input" placeholder="lbs">
                        <input type="number" min="0" max="15" step="0.1" id="wizardWeightCurrentOz" class="hitl-input" placeholder="oz">
                    </div>
                    
                    <div class="optional-toggle-section">
                        <span class="optional-toggle-btn" id="toggleOptionalBtn">
                            <i class="fa-solid fa-chevron-down"></i> Show Optional Historical Stats (Feeds & Diapers)
                        </span>
                    </div>
                    
                    <div id="wizardOptionalFields" style="display: none; flex-direction: column; gap: 8px;">
                        <label for="wizardFeedsPerDay">Avg. Feeds per Day</label>
                        <input type="number" min="0" max="24" id="wizardFeedsPerDay" class="hitl-input" placeholder="e.g. 8">
                        
                        <label>Feeding split (Percentual split)</label>
                        <div class="feeding-split-row">
                            <div class="split-input-group">
                                <input type="number" min="0" max="100" id="wizardBreastPercent" class="hitl-input" placeholder="Breast %">
                            </div>
                            <div class="split-input-group">
                                <input type="number" min="0" max="100" id="wizardFormulaPercent" class="hitl-input" placeholder="Formula %">
                            </div>
                        </div>
                        
                        <label for="wizardWetDiapers">Avg. Wet Diapers per Day</label>
                        <input type="number" min="0" max="24" id="wizardWetDiapers" class="hitl-input" placeholder="e.g. 6">
                        
                        <label for="wizardDirtyDiapers">Avg. Dirty Diapers per Day</label>
                        <input type="number" min="0" max="24" id="wizardDirtyDiapers" class="hitl-input" placeholder="e.g. 4">
                    </div>
                    
                    <div class="wizard-buttons-row" style="display: flex; gap: 10px; margin-top: 15px;">
                        <button class="hitl-btn" id="wizardSubmitBtn" style="flex: 1;">Create Profile</button>
                        <button class="hitl-btn cancel-btn" id="wizardCancelBtn" style="background: transparent; border: 1.5px solid #ff5252; color: #ff5252; flex: 1; border-radius: 6px; cursor: pointer; font-weight: 600;">Cancel Setup</button>
                    </div>
                </div>
            </div>
        `;

        // Set initial weight display fields based on unit toggle
        updateWizardWeightInputs();

        // Photo upload bindings for wizard
        const wPhotoInput = document.getElementById('wizardPhotoInput');
        const wPhotoContainer = document.getElementById('wizardPhotoContainer');
        const wPhotoPreview = document.getElementById('wizardPhotoPreview');
        const wPhotoIcon = document.getElementById('wizardPhotoIcon');
        const wPhotoText = document.getElementById('wizardPhotoText');
        const wRemovePhotoLink = document.getElementById('wizardRemovePhotoLink');

        wPhotoContainer.addEventListener('click', () => {
            wPhotoInput.click();
        });

        wPhotoInput.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (!file) return;
            openCropModal(file, (croppedBase64) => {
                wizardPhotoBase64 = croppedBase64;
                wPhotoPreview.src = wizardPhotoBase64;
                wPhotoPreview.style.display = 'block';
                wPhotoIcon.style.display = 'none';
                wPhotoText.style.display = 'none';
                wRemovePhotoLink.style.display = 'inline-block';
            }, () => {
                wPhotoInput.value = '';
            });
        });

        wRemovePhotoLink.addEventListener('click', (e) => {
            e.stopPropagation(); // Prevent opening file picker when clicking "Remove Photo"
            wizardPhotoBase64 = null;
            wPhotoPreview.src = '';
            wPhotoPreview.style.display = 'none';
            wPhotoIcon.style.display = 'block';
            wPhotoText.style.display = 'inline';
            wRemovePhotoLink.style.display = 'none';
            wPhotoInput.value = '';
        });

        // Setup toggle button
        const toggleBtn = document.getElementById('toggleOptionalBtn');
        const optionalFields = document.getElementById('wizardOptionalFields');
        toggleBtn.addEventListener('click', () => {
            if (optionalFields.style.display === 'none') {
                optionalFields.style.display = 'flex';
                toggleBtn.innerHTML = '<i class="fa-solid fa-chevron-up"></i> Hide Optional Historical Stats';
            } else {
                optionalFields.style.display = 'none';
                toggleBtn.innerHTML = '<i class="fa-solid fa-chevron-down"></i> Show Optional Historical Stats (Feeds & Diapers)';
            }
        });

        // Setup click listener for Cancel Setup
        document.getElementById('wizardCancelBtn').addEventListener('click', () => {
            hitlContainer.innerHTML = '';
            const loader = showTypingLoader();
            const cancelPayload = JSON.stringify({ cancelled: true });
            sendMessage(cancelPayload, {
                interrupt_id: interruptId,
                value: cancelPayload
            }).then(() => {
                if (loader) loader.remove();
            });
        });

        // Setup click listener for Create Profile
        document.getElementById('wizardSubmitBtn').addEventListener('click', () => {
            const dob = document.getElementById('wizardBirthDate').value.trim();
            if (!dob) {
                alert("Please enter a valid birth date.");
                return;
            }
            if (!/^\d{2}\.\d{2}\.\d{4}$/.test(dob)) {
                alert("Please enter birth date in DD.MM.YYYY format.");
                return;
            }

            // Weight calculations
            let weightBirthStr = "";
            let weightCurrentStr = "";
            if (currentUnitSystem === 'metric') {
                const wbKg = parseFloat(document.getElementById('wizardWeightBirthKg').value);
                const wcKg = parseFloat(document.getElementById('wizardWeightCurrentKg').value);
                if (isNaN(wbKg) || isNaN(wcKg)) {
                    alert("Please enter valid birth weight and current weight.");
                    return;
                }
                // Convert metric to imperial string format for backwards compatibility
                const totalLbsBirth = wbKg / 0.45359237;
                const totalOzBirth = Math.round(totalLbsBirth * 16);
                weightBirthStr = `${Math.floor(totalOzBirth / 16)} lbs ${totalOzBirth % 16} oz`;

                const totalLbsCurrent = wcKg / 0.45359237;
                const totalOzCurrent = Math.round(totalLbsCurrent * 16);
                weightCurrentStr = `${Math.floor(totalOzCurrent / 16)} lbs ${totalOzCurrent % 16} oz`;
            } else {
                const wbLbs = parseInt(document.getElementById('wizardWeightBirthLbs').value) || 0;
                const wbOz = parseFloat(document.getElementById('wizardWeightBirthOz').value) || 0;
                const wcLbs = parseInt(document.getElementById('wizardWeightCurrentLbs').value) || 0;
                const wcOz = parseFloat(document.getElementById('wizardWeightCurrentOz').value) || 0;
                if ((wbLbs === 0 && wbOz === 0) || (wcLbs === 0 && wcOz === 0)) {
                    alert("Please enter birth weight and current weight.");
                    return;
                }
                weightBirthStr = `${wbLbs} lbs ${wbOz} oz`;
                weightCurrentStr = `${wcLbs} lbs ${wcOz} oz`;
            }

            // Optional values
            let feedsPerDay = document.getElementById('wizardFeedsPerDay').value;
            let breastPercent = document.getElementById('wizardBreastPercent').value;
            let formulaPercent = document.getElementById('wizardFormulaPercent').value;
            let wetDiapers = document.getElementById('wizardWetDiapers').value;
            let dirtyDiapers = document.getElementById('wizardDirtyDiapers').value;

            // Parse and validate splits if feeds are provided
            if (feedsPerDay && feedsPerDay.trim() !== "") {
                feedsPerDay = parseInt(feedsPerDay);
                breastPercent = breastPercent ? parseFloat(breastPercent) : 0;
                formulaPercent = formulaPercent ? parseFloat(formulaPercent) : 0;
                
                if (breastPercent + formulaPercent > 100) {
                    alert("Sum of Breastfeeding and Formula split cannot exceed 100%.");
                    return;
                }
            } else {
                feedsPerDay = null;
                breastPercent = null;
                formulaPercent = null;
            }

            wetDiapers = wetDiapers && wetDiapers.trim() !== "" ? parseInt(wetDiapers) : null;
            dirtyDiapers = dirtyDiapers && dirtyDiapers.trim() !== "" ? parseInt(dirtyDiapers) : null;

            const payload = {
                birth_date: dob,
                weight_birth: weightBirthStr,
                weight_current: weightCurrentStr,
                feeds_per_day: feedsPerDay,
                breast_percent: breastPercent,
                formula_percent: formulaPercent,
                wet_diapers_per_day: wetDiapers,
                dirty_diapers_per_day: dirtyDiapers,
                photo_base64: wizardPhotoBase64
            };

            const payloadStr = JSON.stringify(payload);

            // Show visual submit choice
            appendMessage(`Created profile. Birth Date: ${dob}, Birth Weight: ${weightBirthStr}, Current Weight: ${weightCurrentStr}`, 'user');
            
            hitlContainer.innerHTML = '';
            const loader = showTypingLoader();

            sendMessage(payloadStr, {
                interrupt_id: interruptId,
                value: payloadStr
            }).then(() => {
                if (loader) loader.remove();
            });
        });
        return;
    }

    // Customize prompt visual
    let inputPlaceholder = "Enter reply...";
    let inputType = "text";
    if (interruptId === 'ask_birth_date') {
        inputPlaceholder = "DD.MM.YYYY (e.g. 04.07.2026)";
        inputType = "text";
    }

    hitlContainer.innerHTML = `
        <div class="hitl-panel">
            <p><i class="fa-solid fa-circle-question"></i> ${promptText}</p>
            <div class="hitl-form">
                <input type="${inputType}" class="hitl-input" id="hitlInput" placeholder="${inputPlaceholder}" required>
                <button class="hitl-btn" id="hitlSubmitBtn">Submit</button>
            </div>
        </div>
    `;

    document.getElementById('hitlSubmitBtn').addEventListener('click', () => {
        const val = document.getElementById('hitlInput').value;
        if (val.trim() === "") return;
        
        // Show choice in chat as a user message
        appendMessage(val, 'user');
        
        // Remove hitl panel and display loader
        hitlContainer.innerHTML = '';
        const loader = showTypingLoader();

        sendMessage(val, {
            interrupt_id: interruptId,
            value: val
        }).then(() => {
            if (loader) loader.remove();
        });
    });
}

// Fetch newborn tracking state from our custom API
async function fetchStats() {
    try {
        const response = await fetch(`/api/stats/${sessionId}`);
        if (!response.ok) return;

        const data = await response.json();
        globalTrackerState = data;

        // Populate Newborn list dropdown
        const newborns = data.newborns || {};
        const keys = Object.keys(newborns).filter(k => k === "test - leo" || k === "test - maya" || k === "test - noah" || !k.startsWith("test -"));

        // Preserve active selection
        const prevSelected = newbornSelect.value;
        newbornSelect.innerHTML = '';

        if (keys.length === 0) {
            newbornSelect.innerHTML = '<option value="">(None)</option>';
            updateBabyHeader(null);
            updateCharts(null);
            return;
        }

        keys.forEach(k => {
            const option = document.createElement('option');
            option.value = k;
            option.innerText = newborns[k].profile.name;
            newbornSelect.appendChild(option);
        });

        // Auto-select active baby
        if (data.active_newborn && newborns[data.active_newborn] && keys.includes(data.active_newborn)) {
            newbornSelect.value = data.active_newborn;
        } else if (prevSelected && newborns[prevSelected] && keys.includes(prevSelected)) {
            newbornSelect.value = prevSelected;
        } else {
            newbornSelect.value = keys[0];
        }

        activeNewbornName = newbornSelect.value;
        const activeNewborn = newborns[activeNewbornName];
        
        const logDataBtn = document.getElementById('logDataBtn');
        if (activeNewborn) {
            updateBabyHeader(activeNewborn);
            updateCharts(activeNewborn);
            if (logDataBtn) logDataBtn.style.display = 'inline-flex';
            if (!initialWelcomeDone) {
                const welcomeMsg = `I've loaded ${activeNewborn.profile.name}'s profile. How can I help you today?`;
                const chatMessages = document.getElementById('chatMessages');
                if (chatMessages) {
                    chatMessages.innerHTML = '';
                    appendMessage(welcomeMsg, 'agent');
                }
                initialWelcomeDone = true;
            }
        } else {
            if (logDataBtn) logDataBtn.style.display = 'none';
        }

    } catch (err) {
        console.error("Error fetching stats:", err);
    }
}

// -------------------------------------------------------------
// Plotted Chart.js Graphics Updates
// -------------------------------------------------------------

// Help parse weights like "7 lbs 8 oz" or "7.5 lbs" or "3200g" to ounces
function parseWeightToLbs(weightStr) {
    if (!weightStr) return 0;
    const cleanStr = weightStr.toLowerCase().trim();
    
    // Check for lbs and oz combination
    if (cleanStr.includes('lbs') || cleanStr.includes('lb')) {
        const lbsPart = cleanStr.split(/lbs|lb/)[0].trim();
        let ozVal = 0;
        if (cleanStr.includes('oz')) {
            const ozMatch = cleanStr.match(/(?:lbs|lb)\s*(\d+)\s*oz/);
            if (ozMatch && ozMatch[1]) {
                ozVal = parseFloat(ozMatch[1]);
            }
        }
        return parseFloat(lbsPart) + (ozVal / 16);
    }
    
    // Check for grams
    if (cleanStr.endsWith('g')) {
        const grams = parseFloat(cleanStr);
        return grams * 0.00220462; // Convert grams to lbs
    }

    return parseFloat(cleanStr) || 0;
}

function calculateAgeInDays(birthDateStr, logDateTimeStr) {
    if (!birthDateStr) return null;
    const bday = new Date(birthDateStr + 'T00:00:00');
    const logDate = new Date(logDateTimeStr.split(' ')[0] + 'T00:00:00');
    const diffTime = logDate - bday;
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    return diffDays >= 0 ? diffDays : null;
}

function filterByRange(logs, rangeDays) {
    if (!logs) return [];
    if (rangeDays === 'all') return logs;
    const limit = parseInt(rangeDays);
    const cutoff = new Date();
    cutoff.setHours(0, 0, 0, 0);
    cutoff.setDate(cutoff.getDate() - limit);
    return logs.filter(log => new Date(log.timestamp.replace(' ', 'T')) >= cutoff);
}

function updateCharts(newbornData) {
    if (!newbornData) {
        // Clear all charts
        ["weight", "feedCount", "feedAmount", "diaper"].forEach(type => {
            document.getElementById(`${type}Chart`).style.display = 'none';
            document.getElementById(`${type}NoData`).style.display = 'flex';
        });
        
        // Clear badges
        document.getElementById('badgeWeight').innerText = "--";
        document.getElementById('badgeFeeds').innerText = "--";
        document.getElementById('badgeDiapers').innerText = "--";
        return;
    }

    const todayStr = new Date().toISOString().split('T')[0];

    // ----------------------------------------
    // Update Badges (Always show latest recorded overall)
    // ----------------------------------------
    const rawWeights = newbornData.weights || [];
    if (rawWeights.length > 0) {
        document.getElementById('badgeWeight').innerText = formatWeight(rawWeights[rawWeights.length - 1].weight_lbs_oz, currentUnitSystem);
    } else {
        document.getElementById('badgeWeight').innerText = "--";
    }

    const rawFeedings = newbornData.feedings || [];
    const feedingsToday = rawFeedings.filter(f => f.timestamp.includes(todayStr)).length;
    document.getElementById('badgeFeeds').innerText = feedingsToday;

    const rawDiapers = newbornData.diapers || [];
    const diapersToday = rawDiapers.filter(d => d.timestamp.includes(todayStr)).length;
    document.getElementById('badgeDiapers').innerText = diapersToday;

    // Generate continuous list of dates for the selected range
    let allDates = [];
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    if (currentRange === 'custom') {
        const startVal = document.getElementById('customStartDate').value;
        const endVal = document.getElementById('customEndDate').value;
        if (startVal && endVal) {
            const start = new Date(startVal + 'T00:00:00');
            const end = new Date(endVal + 'T00:00:00');
            let curr = new Date(start);
            while (curr <= end) {
                allDates.push(curr.toISOString().split('T')[0]);
                curr.setDate(curr.getDate() + 1);
            }
        } else {
            for (let i = 6; i >= 0; i--) {
                const d = new Date();
                d.setDate(today.getDate() - i);
                allDates.push(d.toISOString().split('T')[0]);
            }
        }
    } else {
        let limit;
        if (currentRange === 'all') {
            let earliest = new Date();
            const allLogs = [...rawWeights, ...rawFeedings, ...rawDiapers];
            allLogs.forEach(log => {
                const d = new Date(log.timestamp.replace(' ', 'T'));
                if (d < earliest) earliest = d;
            });
            earliest.setHours(0, 0, 0, 0);
            const diffTime = today - earliest;
            limit = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1;
            if (limit < 7) limit = 7; 
        } else {
            limit = parseInt(currentRange);
        }
        for (let i = limit - 1; i >= 0; i--) {
            const d = new Date();
            d.setDate(today.getDate() - i);
            allDates.push(d.toISOString().split('T')[0]);
        }
    }

    const birthDateStr = newbornData.profile.birth_date;
    const getTickCallback = (dates) => {
        return function(val, index) {
            const total = dates.length;
            if (total <= 7) {
                return this.getLabelForValue(val);
            } else if (total <= 15) {
                return index % 2 === 0 ? this.getLabelForValue(val) : '';
            } else if (total <= 35) {
                return index % 5 === 0 ? this.getLabelForValue(val) : '';
            } else {
                const step = Math.ceil(total / 8);
                return index % step === 0 ? this.getLabelForValue(val) : '';
            }
        };
    };

    // ----------------------------------------
    // 1. Weight Chart
    // ----------------------------------------
    const hasWeightInRange = rawWeights.some(w => allDates.includes(w.timestamp.split(' ')[0]));
    const weightNoData = document.getElementById('weightNoData');
    const weightNotice = document.getElementById('weightAdjustedNotice');

    let weightDates = [...allDates];
    let weightAdjusted = false;

    if (rawWeights.length === 0) {
        document.getElementById('weightChart').style.display = 'none';
        weightNoData.innerText = "No weight entries recorded yet.";
        weightNoData.style.display = 'flex';
        if (weightNotice) weightNotice.style.display = 'none';
    } else if (!hasWeightInRange) {
        document.getElementById('weightChart').style.display = 'none';
        weightNoData.innerText = "No Data for Selected Time Period";
        weightNoData.style.display = 'flex';
        if (weightNotice) weightNotice.style.display = 'none';
    } else {
        if (birthDateStr) {
            const initialLen = weightDates.length;
            weightDates = weightDates.filter(d => d >= birthDateStr);
            if (weightDates.length < initialLen) {
                weightAdjusted = true;
            }
        }
        if (weightNotice) {
            weightNotice.style.display = weightAdjusted ? 'inline-block' : 'none';
            weightNotice.innerHTML = '<i class="fa-solid fa-circle-info"></i> Showing data since birth';
        }

        document.getElementById('weightChart').style.display = 'block';
        weightNoData.style.display = 'none';

        const sortedWeights = [...rawWeights].sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
        const weightVals = [];
        const whoMedianVals = [];

        function getWhoMedianWeight(ageDays) {
            if (ageDays === null || ageDays < 0) return null;
            if (ageDays <= 3) return 7.4 - (ageDays * 0.1); 
            if (ageDays <= 7) return 7.1 + ((ageDays - 3) * 0.075); 
            if (ageDays <= 14) return 7.4 + ((ageDays - 7) * 0.071); 
            if (ageDays <= 28) return 7.9 + ((ageDays - 14) * 0.1); 
            return 9.3 + ((ageDays - 28) * 0.08); 
        }

        let currentWeight = null;
        weightDates.forEach(date => {
            const weightForDate = sortedWeights.find(w => w.timestamp.startsWith(date));
            if (weightForDate) {
                currentWeight = getWeightValue(weightForDate.weight_lbs_oz, currentUnitSystem);
            } else if (currentWeight === null) {
                const priorWeights = sortedWeights.filter(w => new Date(w.timestamp.replace(' ', 'T')) < new Date(date + "T00:00:00"));
                if (priorWeights.length > 0) {
                    currentWeight = getWeightValue(priorWeights[priorWeights.length - 1].weight_lbs_oz, currentUnitSystem);
                }
            }
            weightVals.push(currentWeight);
            
            const age = calculateAgeInDays(newbornData.profile.birth_date, date + " 12:00:00");
            const whoWeightLbs = getWhoMedianWeight(age);
            if (whoWeightLbs === null) {
                whoMedianVals.push(null);
            } else if (currentUnitSystem === 'metric') {
                whoMedianVals.push(whoWeightLbs * 0.45359237);
            } else {
                whoMedianVals.push(whoWeightLbs);
            }
        });

        if (weightChartInst) weightChartInst.destroy();
        
        const datasets = [{
            label: newbornData.profile.name,
            data: weightVals,
            borderColor: '#5f8575',
            backgroundColor: 'rgba(95, 133, 117, 0.1)',
            borderWidth: 3,
            tension: 0.15,
            fill: true
        }];

        if (newbornData.profile.birth_date) {
            datasets.push({
                label: 'WHO 50th Percentile Median',
                data: whoMedianVals,
                borderColor: '#d4a373',
                borderWidth: 2,
                borderDash: [5, 5],
                fill: false,
                pointStyle: 'line'
            });
        }

        const weightUnitLabel = currentUnitSystem === 'metric' ? 'kg' : 'lbs';
        const formattedWeightDates = weightDates.map(formatDateToDMY);

        weightChartInst = new Chart(document.getElementById('weightChart').getContext('2d'), {
            type: 'line',
            data: { labels: formattedWeightDates, datasets: datasets },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    x: {
                        ticks: {
                            autoSkip: false,
                            callback: getTickCallback(formattedWeightDates),
                            maxRotation: 0
                        }
                    },
                    y: { title: { display: true, text: `Weight (${weightUnitLabel})`, font: { family: 'Outfit' } } }
                }
            }
        });
    }

    // Group transactions by date for feedings and diapers
    const getFeedingsByDate = () => {
        const grouped = {};
        rawFeedings.forEach(f => {
            const date = f.timestamp.split(' ')[0];
            if (!grouped[date]) grouped[date] = { breast: 0, formula: 0, solids: 0, breastOz: 0, formulaOz: 0, solidsOz: 0 };
            
            const type = f.type.toLowerCase();
            if (type === 'breastfeeding') {
                grouped[date].breast += 1;
                grouped[date].breastOz += f.amount_oz || 0;
            } else if (type === 'formula') {
                grouped[date].formula += 1;
                grouped[date].formulaOz += f.amount_oz || 0;
            } else if (type === 'solids') {
                grouped[date].solids += 1;
                grouped[date].solidsOz += f.amount_oz || 0;
            } else {
                // combination is split evenly between breastfeeding and formula
                grouped[date].breast += 0.5;
                grouped[date].formula += 0.5;
                grouped[date].formulaOz += (f.amount_oz || 0) / 2;
                grouped[date].breastOz += (f.amount_oz || 0) / 2;
            }
        });
        return grouped;
    };

    const getDiapersByDate = () => {
        const grouped = {};
        rawDiapers.forEach(d => {
            const date = d.timestamp.split(' ')[0];
            if (!grouped[date]) grouped[date] = { wet: 0, dirty: 0 };
            
            const type = d.type.toLowerCase();
            if (type === 'wet') grouped[date].wet += 1;
            else if (type === 'dirty') grouped[date].dirty += 1;
            else if (type === 'both') {
                grouped[date].wet += 1;
                grouped[date].dirty += 1;
            }
        });
        return grouped;
    };

    const feedGrouped = getFeedingsByDate();
    const diaperGrouped = getDiapersByDate();

    // ----------------------------------------
    // 2. Feed Count Chart & 3. Feed Amount Chart
    // ----------------------------------------
    const hasFeedingInRange = rawFeedings.some(f => allDates.includes(f.timestamp.split(' ')[0]));
    const feedCountNoData = document.getElementById('feedCountNoData');
    const feedAmountNoData = document.getElementById('feedAmountNoData');
    const feedCountNotice = document.getElementById('feedCountAdjustedNotice');
    const feedAmountNotice = document.getElementById('feedAmountAdjustedNotice');

    let feedingDates = [...allDates];
    let feedingAdjusted = false;

    if (rawFeedings.length === 0) {
        document.getElementById('feedCountChart').style.display = 'none';
        document.getElementById('feedAmountChart').style.display = 'none';
        feedCountNoData.innerText = "No feed entries recorded yet.";
        feedCountNoData.style.display = 'flex';
        feedAmountNoData.innerText = "No formula or breastmilk amount entries.";
        feedAmountNoData.style.display = 'flex';
        if (feedCountNotice) feedCountNotice.style.display = 'none';
        if (feedAmountNotice) feedAmountNotice.style.display = 'none';
    } else if (!hasFeedingInRange) {
        document.getElementById('feedCountChart').style.display = 'none';
        document.getElementById('feedAmountChart').style.display = 'none';
        feedCountNoData.innerText = "No Data for Selected Time Period";
        feedCountNoData.style.display = 'flex';
        feedAmountNoData.innerText = "No Data for Selected Time Period";
        feedAmountNoData.style.display = 'flex';
        if (feedCountNotice) feedCountNotice.style.display = 'none';
        if (feedAmountNotice) feedAmountNotice.style.display = 'none';
    } else {
        if (birthDateStr) {
            const initialLen = feedingDates.length;
            feedingDates = feedingDates.filter(d => d >= birthDateStr);
            if (feedingDates.length < initialLen) {
                feedingAdjusted = true;
            }
        }
        if (feedCountNotice) {
            feedCountNotice.style.display = feedingAdjusted ? 'inline-block' : 'none';
            feedCountNotice.innerHTML = '<i class="fa-solid fa-circle-info"></i> Showing data since birth';
        }
        if (feedAmountNotice) {
            feedAmountNotice.style.display = feedingAdjusted ? 'inline-block' : 'none';
            feedAmountNotice.innerHTML = '<i class="fa-solid fa-circle-info"></i> Showing data since birth';
        }

        document.getElementById('feedCountChart').style.display = 'block';
        document.getElementById('feedAmountChart').style.display = 'block';
        feedCountNoData.style.display = 'none';
        feedAmountNoData.style.display = 'none';

        const breastCounts = [];
        const formulaCounts = [];
        const solidsCounts = [];

        feedingDates.forEach(d => {
            const stats = feedGrouped[d] || { breast: 0, formula: 0, solids: 0 };
            breastCounts.push(stats.breast);
            formulaCounts.push(stats.formula);
            solidsCounts.push(stats.solids || 0);
        });

        const formattedFeedingDates = feedingDates.map(formatDateToDMY);

        if (feedCountChartInst) feedCountChartInst.destroy();

        feedCountChartInst = new Chart(document.getElementById('feedCountChart').getContext('2d'), {
            type: 'bar',
            data: {
                labels: formattedFeedingDates,
                datasets: [
                    { label: 'Breastfeeding', data: breastCounts, backgroundColor: '#5f8575' },
                    { label: 'Formula', data: formulaCounts, backgroundColor: '#d4a373' },
                    { label: 'Solids', data: solidsCounts, backgroundColor: '#8a624a' }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    x: { 
                        stacked: true,
                        ticks: {
                            autoSkip: false,
                            callback: getTickCallback(formattedFeedingDates),
                            maxRotation: 0
                        }
                    },
                    y: { stacked: true, title: { display: true, text: 'Feedings count' } }
                }
            }
        });

        const breastOzs = [];
        const formulaOzs = [];
        const solidsOzs = [];
        const totalOzs = [];

        feedingDates.forEach(d => {
            const stats = feedGrouped[d] || { breastOz: 0, formulaOz: 0, solidsOz: 0 };
            breastOzs.push(getFeedAmountValue(stats.breastOz, currentUnitSystem));
            formulaOzs.push(getFeedAmountValue(stats.formulaOz, currentUnitSystem));
            solidsOzs.push(getFeedAmountValue(stats.solidsOz || 0, currentUnitSystem));
            totalOzs.push(getFeedAmountValue(stats.breastOz + stats.formulaOz + (stats.solidsOz || 0), currentUnitSystem));
        });

        const volUnitLabel = currentUnitSystem === 'metric' ? 'ml' : 'oz';
        if (feedAmountChartInst) feedAmountChartInst.destroy();
        feedAmountChartInst = new Chart(document.getElementById('feedAmountChart').getContext('2d'), {
            type: 'line',
            data: {
                labels: formattedFeedingDates,
                datasets: [
                    { label: `Total Volume (${volUnitLabel})`, data: totalOzs, borderColor: '#2f3e36', borderWidth: 2, tension: 0.15 },
                    { label: `Formula (${volUnitLabel})`, data: formulaOzs, borderColor: '#d4a373', borderDash: [3, 3], tension: 0.15 },
                    { label: `Breastmilk (${volUnitLabel})`, data: breastOzs, borderColor: '#5f8575', borderDash: [3, 3], tension: 0.15 },
                    { label: `Solids (${volUnitLabel})`, data: solidsOzs, borderColor: '#8a624a', borderDash: [3, 3], tension: 0.15 }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    x: {
                        ticks: {
                            autoSkip: false,
                            callback: getTickCallback(formattedFeedingDates),
                            maxRotation: 0
                        }
                    },
                    y: { title: { display: true, text: `Volume (${volUnitLabel})` } }
                }
            }
        });
    }

    // ----------------------------------------
    // 4. Diaper Status Chart
    // ----------------------------------------
    // ----------------------------------------
    // 4. Diaper Status Chart
    // ----------------------------------------
    const hasDiaperInRange = rawDiapers.some(d => allDates.includes(d.timestamp.split(' ')[0]));
    const diaperNoData = document.getElementById('diaperNoData');
    const diaperNotice = document.getElementById('diaperAdjustedNotice');

    let diaperDates = [...allDates];
    let diaperAdjusted = false;

    if (rawDiapers.length === 0) {
        document.getElementById('diaperChart').style.display = 'none';
        diaperNoData.innerText = "No diaper change records yet.";
        diaperNoData.style.display = 'flex';
        if (diaperNotice) diaperNotice.style.display = 'none';
    } else if (!hasDiaperInRange) {
        document.getElementById('diaperChart').style.display = 'none';
        diaperNoData.innerText = "No Data for Selected Time Period";
        diaperNoData.style.display = 'flex';
        if (diaperNotice) diaperNotice.style.display = 'none';
    } else {
        if (birthDateStr) {
            const initialLen = diaperDates.length;
            diaperDates = diaperDates.filter(d => d >= birthDateStr);
            if (diaperDates.length < initialLen) {
                diaperAdjusted = true;
            }
        }
        if (diaperNotice) {
            diaperNotice.style.display = diaperAdjusted ? 'inline-block' : 'none';
            diaperNotice.innerHTML = '<i class="fa-solid fa-circle-info"></i> Showing data since birth';
        }

        document.getElementById('diaperChart').style.display = 'block';
        diaperNoData.style.display = 'none';

        const wetCounts = [];
        const dirtyCounts = [];

        diaperDates.forEach(d => {
            const stats = diaperGrouped[d] || { wet: 0, dirty: 0 };
            wetCounts.push(stats.wet);
            dirtyCounts.push(stats.dirty);
        });

        const formattedDiaperDates = diaperDates.map(formatDateToDMY);

        if (diaperChartInst) diaperChartInst.destroy();

        diaperChartInst = new Chart(document.getElementById('diaperChart').getContext('2d'), {
            type: 'bar',
            data: {
                labels: formattedDiaperDates,
                datasets: [
                    { label: 'Wet Diapers', data: wetCounts, backgroundColor: '#a9c2b4' },
                    { label: 'Dirty Diapers', data: dirtyCounts, backgroundColor: '#c8a27d' }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    x: {
                        ticks: {
                            autoSkip: false,
                            callback: getTickCallback(formattedDiaperDates),
                            maxRotation: 0
                        }
                    },
                    y: {
                        title: { display: true, text: 'Diaper changes' },
                        suggestedMax: 8
                    }
                }
            }
        });
    }
    updateHistoricalLogsTable();
}

// -------------------------------------------------------------
// Event Listeners & Bootstrapping
// -------------------------------------------------------------

// Handle newborn dropdown selections
newbornSelect.addEventListener('change', async () => {
    const selected = newbornSelect.value;
    if (globalTrackerState && globalTrackerState.newborns && globalTrackerState.newborns[selected]) {
        activeNewbornName = selected;
        const nb = globalTrackerState.newborns[selected];
        updateBabyHeader(nb);
        updateCharts(nb);
        
        // Notify backend session of active newborn change
        await fetch(`/api/session/${sessionId}/active`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ active_newborn: selected })
        });
        
        // Acknowledge change in next response
        appendMessage(`Switched active profile to ${nb.profile.name}. All data and insights have been updated.`, 'agent');
    } else {
        updateBabyHeader(null);
        updateCharts(null);
    }
});

// Form submission for chat message
chatForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = chatInput.value.trim();
    if (text === "") return;

    chatInput.value = "";
    sendMessage(text);
});

// Initialize state on page load
fetchStats();

// -------------------------------------------------------------
// Log Data Form Wizard Modal Logic
// -------------------------------------------------------------
const logDataBtn = document.getElementById('logDataBtn');
const logDataModal = document.getElementById('logDataModal');
const closeLogDataModalBtn = document.getElementById('closeLogDataModalBtn');
const logCancelBtn = document.getElementById('logCancelBtn');
const logSaveBtn = document.getElementById('logSaveBtn');

// Wizard steps
const logStep1 = document.getElementById('logStep1');
const logStep2Weight = document.getElementById('logStep2Weight');
const logStep2Feeding = document.getElementById('logStep2Feeding');
const logStep2Diapers = document.getElementById('logStep2Diapers');
const logStep3 = document.getElementById('logStep3');

// Selection buttons
const logSelectWeightBtn = document.getElementById('logSelectWeightBtn');
const logSelectFeedingBtn = document.getElementById('logSelectFeedingBtn');
const logSelectDiapersBtn = document.getElementById('logSelectDiapersBtn');

// Loop buttons
const logLoopYesBtn = document.getElementById('logLoopYesBtn');
const logLoopNoBtn = document.getElementById('logLoopNoBtn');

let selectedCategory = null;
let editingLog = null; // Stores { category, originalTimestamp }

function resetWizard() {
    selectedCategory = null;
    editingLog = null;
    logStep1.style.display = 'block';
    logStep2Weight.style.display = 'none';
    logStep2Feeding.style.display = 'none';
    logStep2Diapers.style.display = 'none';
    logStep3.style.display = 'none';
    logSaveBtn.style.display = 'none';
    logCancelBtn.style.display = 'block';

    const now = new Date();
    const tzoffset = now.getTimezoneOffset() * 60000;
    const localISOTime = (new Date(now - tzoffset)).toISOString().slice(0, 16);
    document.getElementById('logWeightTime').value = localISOTime;
    document.getElementById('logFeedingTime').value = localISOTime;
    document.getElementById('logDiaperTime').value = localISOTime;

    document.getElementById('logWeightLbs').value = '';
    document.getElementById('logWeightOz').value = '';
    document.getElementById('logWeightKg').value = '';
    document.getElementById('logFeedingAmount').value = '';
    
    const unitLabel = currentUnitSystem === 'metric' ? 'ml' : 'oz';
    document.getElementById('logFeedingAmountUnit').innerText = unitLabel;

    const isMetric = currentUnitSystem === 'metric';
    document.getElementById('logWeightKg').style.display = isMetric ? 'block' : 'none';
    document.getElementById('logWeightLbs').style.display = isMetric ? 'none' : 'block';
    document.getElementById('logWeightOz').style.display = isMetric ? 'none' : 'block';
}

function openEditWizard(category, originalTimestamp) {
    resetWizard();
    editingLog = { category, originalTimestamp };
    selectedCategory = category === 'diaper' ? 'diapers' : category;

    logStep1.style.display = 'none';

    if (category === 'weight') {
        logStep2Weight.style.display = 'block';
    } else if (category === 'feeding') {
        logStep2Feeding.style.display = 'block';
    } else if (category === 'diaper' || category === 'diapers') {
        logStep2Diapers.style.display = 'block';
    }

    logSaveBtn.style.display = 'block';
    hydrateEditFields(category, originalTimestamp);
    logDataModal.style.display = 'flex';
}

function hydrateEditFields(category, originalTimestamp) {
    if (!globalTrackerState || !activeNewbornName) return;
    const nb = globalTrackerState.newborns[activeNewbornName];
    if (!nb) return;

    if (category === 'weight') {
        const log = (nb.weights || []).find(w => w.timestamp === originalTimestamp);
        if (log) {
            document.getElementById('logWeightTime').value = log.timestamp.replace(' ', 'T').slice(0, 16);
            const weightStr = log.weight_lbs_oz;
            if (weightStr.includes('kg')) {
                document.getElementById('logWeightKg').value = parseFloat(weightStr);
            } else if (weightStr.includes('lbs') || weightStr.includes('lb')) {
                const lbsPart = parseFloat(weightStr);
                let ozVal = 0;
                const ozMatch = weightStr.match(/(?:lbs|lb)\s*(\d+(\.\d+)?)\s*oz/);
                if (ozMatch && ozMatch[1]) {
                    ozVal = parseFloat(ozMatch[1]);
                }
                document.getElementById('logWeightLbs').value = lbsPart;
                document.getElementById('logWeightOz').value = ozVal;
            } else {
                document.getElementById('logWeightLbs').value = parseFloat(weightStr) || '';
            }
        }
    } else if (category === 'feeding') {
        const log = (nb.feedings || []).find(f => f.timestamp === originalTimestamp);
        if (log) {
            document.getElementById('logFeedingTime').value = log.timestamp.replace(' ', 'T').slice(0, 16);
            document.getElementById('logFeedingType').value = log.type || 'combination';
            const amtOz = log.amount_oz;
            if (currentUnitSystem === 'metric') {
                document.getElementById('logFeedingAmount').value = (amtOz * 29.5735).toFixed(1);
            } else {
                document.getElementById('logFeedingAmount').value = amtOz.toFixed(1);
            }
        }
    } else if (category === 'diaper' || category === 'diapers') {
        const log = (nb.diapers || []).find(d => d.timestamp === originalTimestamp);
        if (log) {
            document.getElementById('logDiaperTime').value = log.timestamp.replace(' ', 'T').slice(0, 16);
            document.getElementById('logDiaperType').value = log.type || 'wet';
        }
    }
}

if (logDataBtn) {
    logDataBtn.addEventListener('click', () => {
        if (!activeNewbornName) return;
        resetWizard();
        logDataModal.style.display = 'flex';
    });
}

const hideModalHandler = () => {
    logDataModal.style.display = 'none';
};

if (closeLogDataModalBtn) closeLogDataModalBtn.addEventListener('click', hideModalHandler);
if (logCancelBtn) logCancelBtn.addEventListener('click', hideModalHandler);

logSelectWeightBtn.addEventListener('click', () => {
    selectedCategory = 'weight';
    logStep1.style.display = 'none';
    logStep2Weight.style.display = 'block';
    logSaveBtn.style.display = 'block';
});

logSelectFeedingBtn.addEventListener('click', () => {
    selectedCategory = 'feeding';
    logStep1.style.display = 'none';
    logStep2Feeding.style.display = 'block';
    logSaveBtn.style.display = 'block';
});

logSelectDiapersBtn.addEventListener('click', () => {
    selectedCategory = 'diapers';
    logStep1.style.display = 'none';
    logStep2Diapers.style.display = 'block';
    logSaveBtn.style.display = 'block';
});

logLoopYesBtn.addEventListener('click', () => {
    resetWizard();
});

logLoopNoBtn.addEventListener('click', () => {
    hideModalHandler();
});

logSaveBtn.addEventListener('click', async () => {
    if (!activeNewbornName || !selectedCategory) return;

    let payload = {
        category: selectedCategory,
    };

    if (selectedCategory === 'weight') {
        let weightStr = "";
        const timeInput = document.getElementById('logWeightTime').value;
        payload.timestamp = timeInput ? timeInput.replace('T', ' ') + ':00' : new Date().toISOString().slice(0, 19).replace('T', ' ');

        if (currentUnitSystem === 'metric') {
            const kg = parseFloat(document.getElementById('logWeightKg').value);
            if (isNaN(kg) || kg <= 0) {
                alert("Please enter a valid weight in kg.");
                return;
            }
            const totalLbs = kg / 0.45359237;
            const totalOz = Math.round(totalLbs * 16);
            weightStr = `${Math.floor(totalOz / 16)} lbs ${totalOz % 16} oz`;
        } else {
            const lbs = parseInt(document.getElementById('logWeightLbs').value) || 0;
            const oz = parseFloat(document.getElementById('logWeightOz').value) || 0;
            if (lbs <= 0 && oz <= 0) {
                alert("Please enter a valid weight in lbs/oz.");
                return;
            }
            weightStr = `${lbs} lbs ${oz} oz`;
        }
        payload.weight_lbs_oz = weightStr;

    } else if (selectedCategory === 'feeding') {
        const type = document.getElementById('logFeedingType').value;
        const amountVal = parseFloat(document.getElementById('logFeedingAmount').value);
        if (isNaN(amountVal) || amountVal <= 0) {
            alert("Please enter a valid amount.");
            return;
        }

        const timeInput = document.getElementById('logFeedingTime').value;
        payload.timestamp = timeInput ? timeInput.replace('T', ' ') + ':00' : new Date().toISOString().slice(0, 19).replace('T', ' ');
        payload.feeding_type = type;

        if (currentUnitSystem === 'metric') {
            payload.feeding_amount_oz = amountVal / 29.5735;
        } else {
            payload.feeding_amount_oz = amountVal;
        }

    } else if (selectedCategory === 'diapers') {
        const diaperType = document.getElementById('logDiaperType').value;
        const timeInput = document.getElementById('logDiaperTime').value;
        payload.timestamp = timeInput ? timeInput.replace('T', ' ') + ':00' : new Date().toISOString().slice(0, 19).replace('T', ' ');
        payload.diaper_type = diaperType;
    }

    try {
        logSaveBtn.disabled = true;
        logSaveBtn.innerText = "Saving...";

        let response;
        if (editingLog) {
            const putPayload = {
                category: editingLog.category,
                original_timestamp: editingLog.originalTimestamp,
                new_timestamp: payload.timestamp,
                weight_lbs_oz: payload.weight_lbs_oz,
                feeding_type: payload.feeding_type,
                feeding_amount_oz: payload.feeding_amount_oz,
                diaper_type: payload.diaper_type
            };
            response = await fetch(`/api/profiles/${activeNewbornName}/logs`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(putPayload)
            });
        } else {
            response = await fetch(`/api/profiles/${activeNewbornName}/logs`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
        }

        if (response.ok) {
            logStep2Weight.style.display = 'none';
            logStep2Feeding.style.display = 'none';
            logStep2Diapers.style.display = 'none';
            logStep3.style.display = 'block';
            logSaveBtn.style.display = 'none';
            logCancelBtn.style.display = 'none';

            await fetchStats();
        } else {
            alert("Failed to save log entry.");
        }
    } catch (err) {
        console.error(err);
        alert("Error saving log entry.");
    } finally {
        logSaveBtn.disabled = false;
        logSaveBtn.innerText = "Save Entry";
    }
});

// -------------------------------------------------------------
// Bookmarks Navigation and Historical Logs Table Logic
// -------------------------------------------------------------
const tabDashboard = document.getElementById('tabDashboard');
const tabHistoricalLogs = document.getElementById('tabHistoricalLogs');
const bookmarksViewWrapper = document.getElementById('bookmarksViewWrapper');
const dashboardPanel = document.getElementById('dashboardPanel');
const logsPanel = document.getElementById('logsPanel');
const logFilterType = document.getElementById('logFilterType');

if (tabDashboard && tabHistoricalLogs) {
    tabDashboard.addEventListener('click', () => {
        tabDashboard.classList.add('active');
        tabHistoricalLogs.classList.remove('active');
        
        tabDashboard.style.background = 'white';
        tabDashboard.style.color = 'var(--color-primary-dark)';
        tabDashboard.style.zIndex = '5';
        
        tabHistoricalLogs.style.background = '#e5eae6';
        tabHistoricalLogs.style.color = 'var(--color-text-light)';
        tabHistoricalLogs.style.zIndex = '2';
        
        bookmarksViewWrapper.style.transform = 'translateX(0%)';
        dashboardPanel.style.opacity = '1';
        dashboardPanel.style.pointerEvents = 'auto';
        dashboardPanel.classList.remove('inactive');
        
        logsPanel.style.opacity = '0';
        logsPanel.style.pointerEvents = 'none';
        logsPanel.classList.add('inactive');
    });

    tabHistoricalLogs.addEventListener('click', () => {
        tabHistoricalLogs.classList.add('active');
        tabDashboard.classList.remove('active');
        
        tabHistoricalLogs.style.background = 'white';
        tabHistoricalLogs.style.color = 'var(--color-primary-dark)';
        tabHistoricalLogs.style.zIndex = '5';
        
        tabDashboard.style.background = '#e5eae6';
        tabDashboard.style.color = 'var(--color-text-light)';
        tabDashboard.style.zIndex = '2';
        
        bookmarksViewWrapper.style.transform = 'translateX(-50%)';
        logsPanel.style.opacity = '1';
        logsPanel.style.pointerEvents = 'auto';
        logsPanel.classList.remove('inactive');
        
        dashboardPanel.style.opacity = '0';
        dashboardPanel.style.pointerEvents = 'none';
        dashboardPanel.classList.add('inactive');
        
        updateHistoricalLogsTable();
    });
}

if (logFilterType) {
    logFilterType.addEventListener('change', () => {
        updateHistoricalLogsTable();
    });
}

function updateHistoricalLogsTable() {
    const tableBody = document.getElementById('historicalLogsTableBody');
    if (!tableBody) return;
    tableBody.innerHTML = '';

    if (!globalTrackerState || !activeNewbornName) return;
    const nb = globalTrackerState.newborns[activeNewbornName];
    if (!nb) return;

    const rawWeights = nb.weights || [];
    const rawFeedings = nb.feedings || [];
    const rawDiapers = nb.diapers || [];

    let combinedLogs = [];

    rawWeights.forEach(w => {
        combinedLogs.push({
            timestamp: w.timestamp,
            category: 'weight',
            categoryLabel: 'Weight',
            details: formatWeight(w.weight_lbs_oz, currentUnitSystem)
        });
    });

    rawFeedings.forEach(f => {
        combinedLogs.push({
            timestamp: f.timestamp,
            category: 'feeding',
            categoryLabel: 'Feeding',
            details: `${f.type.charAt(0).toUpperCase() + f.type.slice(1)}: ${getFeedAmountValue(f.amount_oz, currentUnitSystem).toFixed(1)} ${currentUnitSystem === 'metric' ? 'ml' : 'oz'}`
        });
    });

    rawDiapers.forEach(d => {
        combinedLogs.push({
            timestamp: d.timestamp,
            category: 'diaper',
            categoryLabel: 'Diaper',
            details: d.type.charAt(0).toUpperCase() + d.type.slice(1)
        });
    });

    // Sort newest first
    combinedLogs.sort((a, b) => new Date(b.timestamp.replace(' ', 'T')) - new Date(a.timestamp.replace(' ', 'T')));

    // Filter
    const filter = logFilterType ? logFilterType.value : 'all';
    if (filter !== 'all') {
        combinedLogs = combinedLogs.filter(log => log.category === filter);
    }

    if (combinedLogs.length === 0) {
        tableBody.innerHTML = `<tr><td colspan="4" style="text-align: center; padding: 24px; color: var(--color-text-light); font-weight: 500;">No historical logs found for this baby.</td></tr>`;
        return;
    }

    combinedLogs.forEach(log => {
        const tr = document.createElement('tr');
        tr.style.borderBottom = '1px solid #eee';
        tr.innerHTML = `
            <td style="padding: 12px 16px; font-weight: 500; color: var(--color-text);">${log.timestamp}</td>
            <td style="padding: 12px 16px;"><span style="padding: 3px 8px; border-radius: 6px; font-weight: 600; font-size: 12px; background: ${getCategoryBg(log.category)}; color: ${getCategoryColor(log.category)};">${log.categoryLabel}</span></td>
            <td style="padding: 12px 16px; font-weight: 500; color: var(--color-text-light);">${log.details}</td>
            <td style="padding: 12px 16px;">
                <button class="edit-log-btn" style="background: none; border: none; color: var(--color-primary); cursor: pointer; font-size: 13.5px; font-weight: 600; display: inline-flex; align-items: center; gap: 4px;" data-category="${log.category}" data-timestamp="${log.timestamp}">
                    <i class="fa-solid fa-pen-to-square"></i> Edit
                </button>
            </td>
        `;
        tableBody.appendChild(tr);
    });
}

const tableBodyEl = document.getElementById('historicalLogsTableBody');
if (tableBodyEl) {
    tableBodyEl.addEventListener('click', (e) => {
        const btn = e.target.closest('.edit-log-btn');
        if (!btn) return;
        const category = btn.getAttribute('data-category');
        const timestamp = btn.getAttribute('data-timestamp');
        openEditWizard(category, timestamp);
    });
}

function getCategoryBg(cat) {
    if (cat === 'weight') return 'rgba(95, 133, 117, 0.12)';
    if (cat === 'feeding') return 'rgba(212, 163, 115, 0.12)';
    return 'rgba(141, 110, 99, 0.12)';
}

function getCategoryColor(cat) {
    if (cat === 'weight') return 'var(--color-primary-dark)';
    if (cat === 'feeding') return '#a05c1b';
    return '#5d4037';
}
