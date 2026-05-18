import { useState } from 'react'

const ONBOARDING_KEY = 'sprc_ops_onboarding_done'

const steps = [
  {
    title: 'Welcome to Ops Hub',
    body: 'This is your home base for your shift. Everything you need to do — transports, vehicle checks, and house checks — is right here on your home screen.'
  },
  {
    title: 'Starting a transport',
    body: 'Tap "Start transport" when you\'re taking a client somewhere. Just add who\'s going, where they\'re headed, and the reason. When you get back, tap "Finish transport" and answer the DC paperwork question.'
  },
  {
    title: 'Completing EOCs',
    body: 'Your Van EOC and House EOC checklists show up when they\'re due. Go through each item — tap OK or Repair. If something needs repair, type a quick note about what\'s wrong. Your progress is saved automatically.'
  },
  {
    title: 'Reporting issues',
    body: 'When you mark something as "Repair" on an EOC, it automatically creates an issue report for your supervisor. You\'ll see updates in your feed when issues are being addressed.'
  },
  {
    title: 'You\'re all set',
    body: 'Red borders mean something needs your attention now. If you get pulled away, don\'t worry — everything saves automatically. Just come back and pick up where you left off.'
  }
]

function Onboarding({ onComplete }) {
  const [currentStep, setCurrentStep] = useState(0)

  const handleNext = () => {
    if (currentStep < steps.length - 1) {
      setCurrentStep(currentStep + 1)
    } else {
      localStorage.setItem(ONBOARDING_KEY, 'true')
      onComplete()
    }
  }

  const handleSkip = () => {
    localStorage.setItem(ONBOARDING_KEY, 'true')
    onComplete()
  }

  const step = steps[currentStep]
  const isLast = currentStep === steps.length - 1

  return (
    <div className="onboarding-overlay">
      <div className="onboarding-card">
        <div className="onboarding-title">{step.title}</div>
        <div className="onboarding-body">{step.body}</div>
        <div className="onboarding-dots">
          {steps.map((_, i) => (
            <div
              key={i}
              className={`onboarding-dot ${i === currentStep ? 'onboarding-dot-active' : ''}`}
            />
          ))}
        </div>
        <button className="onboarding-btn" onClick={handleNext}>
          {isLast ? 'Get started' : 'Next'}
        </button>
        {!isLast && (
          <button className="onboarding-skip" onClick={handleSkip}>
            Skip tour
          </button>
        )}
      </div>
    </div>
  )
}

export default Onboarding
