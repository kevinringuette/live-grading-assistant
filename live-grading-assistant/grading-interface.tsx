import React, { useState, useEffect } from 'react';
import { Mic, Square, Settings, Upload, Download, Plus, Trash2, Play } from 'lucide-react';

// ============================================================================
// CONFIGURATION - UPDATE THESE VALUES
// ============================================================================
const CONFIG = {
  // Your Airtable Configuration
  AIRTABLE_API_KEY: 'patCUB0HwqgJr9nOr.ab696a1c2674dbab6d5c447011caecdc6a545751332aca30bcf9a0160f9100c6',
  AIRTABLE_BASE_ID: 'appTwYDVvnYPB8D2N', // e.g., 'appTwYDVvnYPB8D2N'
  
  // Your n8n Webhook URL
  N8N_WEBHOOK_URL: 'https://kringuette0.app.n8n.cloud/webhook-test/voice-grader', // e.g., 'https://your-n8n.com/webhook/grading'
  
  // Airtable Table Names (update if your table names are different)
  TABLES: {
    TEACHERS: 'Teachers',
    SECTIONS: 'Master Sections',
    STUDENTS: 'Student Roster',
    GRADES: 'Grades',
    RUBRICS: 'Rubrics'
  },
  
  // Airtable Field Names (update if your field names are different)
  FIELDS: {
    TEACHERS: {
      NAME: 'Name',
      EMAIL: 'Email',
      FIRST_NAME: 'First Name',
      LAST_NAME: 'Last Name',
      SECTIONS: 'Master Sections'
    },
    SECTIONS: {
      NAME: 'Section Name',
      SECTION_ID: 'Section ID',
      TEACHER_LINK: 'Teacher Link',
      STUDENT_ROSTER: 'Student Roster'
    },
    STUDENTS: {
      NAME: 'Name',
      EMAIL: 'Email',
      ID: 'ID',
      SECTIONS: 'Master Sections'
    },
    GRADES: {
      ASSIGNMENT: 'Assignment',
      STUDENT: 'Student',
      COMMENTS: 'Comments',
      FINAL_GRADE: 'Final Grade'
    }
  }
};

// ============================================================================
// MAIN COMPONENT
// ============================================================================
export default function GradingInterface() {
  const [step, setStep] = useState('teacher-select');
  const [isRecording, setIsRecording] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  
  // Setup data
  const [teachers, setTeachers] = useState([]);
  const [selectedTeacher, setSelectedTeacher] = useState(null);
  const [sections, setSections] = useState([]);
  const [selectedSection, setSelectedSection] = useState(null);
  const [students, setStudents] = useState([]);
  
  // Assignment setup
  const [assignmentName, setAssignmentName] = useState('');
  const [rubricItems, setRubricItems] = useState([
    { name: 'Correctness', maxPoints: 25 },
    { name: 'Method', maxPoints: 25 },
    { name: 'Clarity', maxPoints: 25 },
    { name: 'Completeness', maxPoints: 25 }
  ]);
  
  // Grading data
  const [grades, setGrades] = useState({});
  const [currentStudent, setCurrentStudent] = useState(null);
  const [transcript, setTranscript] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [editingStudent, setEditingStudent] = useState(null);
  const [editingField, setEditingField] = useState(null);
  const [audioChunks, setAudioChunks] = useState([]);
  const [processingAudio, setProcessingAudio] = useState(false);
  const [sessionId, setSessionId] = useState(null);

  // Check configuration on mount
  useEffect(() => {
    if (CONFIG.AIRTABLE_API_KEY === 'YOUR_AIRTABLE_API_KEY_HERE') {
      setError('Please configure your Airtable API key in the CONFIG section of the code.');
    }
    if (CONFIG.N8N_WEBHOOK_URL === 'YOUR_N8N_WEBHOOK_URL_HERE') {
      console.warn('n8n webhook URL not configured. Audio processing will not work.');
    }
    loadTeachersFromAirtable();
  }, []);

  // Timer for recording
  useEffect(() => {
    let interval;
    if (isRecording) {
      interval = setInterval(() => {
        setRecordingTime(prev => prev + 1);
      }, 1000);
    } else {
      setRecordingTime(0);
    }
    return () => clearInterval(interval);
  }, [isRecording]);

  // Spacebar listener for processing audio chunks
  useEffect(() => {
    const handleKeyPress = (e) => {
      if (e.code === 'Space' && isRecording && !editingStudent) {
        e.preventDefault();
        processCurrentAudioChunk();
      }
    };

    window.addEventListener('keydown', handleKeyPress);
    return () => window.removeEventListener('keydown', handleKeyPress);
  }, [isRecording, editingStudent, audioChunks]);

  // ============================================================================
  // AIRTABLE API FUNCTIONS
  // ============================================================================
  
  const airtableRequest = async (endpoint, options = {}) => {
    const url = `https://api.airtable.com/v0/${CONFIG.AIRTABLE_BASE_ID}/${endpoint}`;
    const response = await fetch(url, {
      ...options,
      headers: {
        'Authorization': `Bearer ${CONFIG.AIRTABLE_API_KEY}`,
        'Content-Type': 'application/json',
        ...options.headers
      }
    });
    
    if (!response.ok) {
      throw new Error(`Airtable API error: ${response.statusText}`);
    }
    
    return response.json();
  };

  const loadTeachersFromAirtable = async () => {
    setLoading(true);
    setError(null);
    
    try {
      const data = await airtableRequest(CONFIG.TABLES.TEACHERS);
      
      const teachersList = data.records.map(record => ({
        id: record.id,
        name: record.fields[CONFIG.FIELDS.TEACHERS.NAME] || 
              `${record.fields[CONFIG.FIELDS.TEACHERS.FIRST_NAME]} ${record.fields[CONFIG.FIELDS.TEACHERS.LAST_NAME]}`,
        email: record.fields[CONFIG.FIELDS.TEACHERS.EMAIL]
      }));
      
      setTeachers(teachersList);
    } catch (err) {
      console.error('Error loading teachers:', err);
      setError('Failed to load teachers from Airtable. Check your configuration and API key.');
    } finally {
      setLoading(false);
    }
  };

  const selectTeacher = async (teacher) => {
    setSelectedTeacher(teacher);
    setLoading(true);
    setStep('class-select');
    setError(null);
    
    try {
      // Filter sections by teacher
      const filterFormula = `SEARCH("${teacher.id}", ARRAYJOIN({${CONFIG.FIELDS.SECTIONS.TEACHER_LINK}}))`;
      const data = await airtableRequest(
        `${CONFIG.TABLES.SECTIONS}?filterByFormula=${encodeURIComponent(filterFormula)}`
      );
      
      const sectionsList = data.records.map(record => ({
        id: record.id,
        name: record.fields[CONFIG.FIELDS.SECTIONS.NAME],
        studentCount: record.fields[CONFIG.FIELDS.SECTIONS.STUDENT_ROSTER]?.length || 0,
        sectionId: record.fields[CONFIG.FIELDS.SECTIONS.SECTION_ID]
      }));
      
      setSections(sectionsList);
    } catch (err) {
      console.error('Error loading sections:', err);
      setError('Failed to load sections. Check console for details.');
    } finally {
      setLoading(false);
    }
  };

  const selectSection = async (section) => {
    setSelectedSection(section);
    setLoading(true);
    setStep('setup');
    setError(null);
    
    try {
      // Get section details to retrieve student IDs
      const sectionData = await airtableRequest(`${CONFIG.TABLES.SECTIONS}/${section.id}`);
      const studentIds = sectionData.fields[CONFIG.FIELDS.SECTIONS.STUDENT_ROSTER] || [];
      
      if (studentIds.length === 0) {
        setError('No students found in this section');
        setStudents([]);
        setLoading(false);
        return;
      }
      
      // Fetch all students
      const studentsPromises = studentIds.map(studentId =>
        airtableRequest(`${CONFIG.TABLES.STUDENTS}/${studentId}`)
      );
      
      const studentsData = await Promise.all(studentsPromises);
      const studentsList = studentsData.map(data => ({
        id: data.id,
        name: data.fields[CONFIG.FIELDS.STUDENTS.NAME],
        email: data.fields[CONFIG.FIELDS.STUDENTS.EMAIL],
        studentId: data.fields[CONFIG.FIELDS.STUDENTS.ID]?.toString() || 'N/A'
      }));
      
      setStudents(studentsList);
      
      // Initialize empty grades
      const initialGrades = {};
      studentsList.forEach(student => {
        initialGrades[student.id] = {
          scores: {},
          comments: '',
          completed: false
        };
      });
      setGrades(initialGrades);
      
    } catch (err) {
      console.error('Error loading students:', err);
      setError('Failed to load students. Check console for details.');
    } finally {
      setLoading(false);
    }
  };

  // ============================================================================
  // RECORDING AND AUDIO PROCESSING
  // ============================================================================
  
  const startRecording = () => {
    setIsRecording(true);
    setTranscript([]);
    setAudioChunks([]);
    setSessionId(Date.now().toString()); // Generate unique session ID
    // TODO: Initialize MediaRecorder here for real audio capture
  };

  const stopRecording = () => {
    setIsRecording(false);
    setAudioChunks([]);
    setCurrentStudent(null);
    // TODO: Stop MediaRecorder here
  };

  const processCurrentAudioChunk = async () => {
    if (processingAudio) return;
    
    setProcessingAudio(true);
    setTranscript(prev => [...prev, {
      text: '⏳ Processing...',
      timestamp: new Date().toISOString(),
      isProcessing: true
    }]);

    try {
      // TODO: Get actual audio blob from MediaRecorder
      const audioBlob = null; // Replace with actual audio data
      
      if (CONFIG.N8N_WEBHOOK_URL !== 'YOUR_N8N_WEBHOOK_URL_HERE' && audioBlob) {
        // Send to n8n webhook
        const formData = new FormData();
        formData.append('audio', audioBlob);
        formData.append('sessionId', sessionId);
        formData.append('teacherId', selectedTeacher.id);
        formData.append('sectionId', selectedSection.id);
        formData.append('assignmentName', assignmentName);
        formData.append('rubricItems', JSON.stringify(rubricItems));
        formData.append('students', JSON.stringify(students));
        
        const response = await fetch(CONFIG.N8N_WEBHOOK_URL, {
          method: 'POST',
          body: formData
        });
        
        const result = await response.json();
        
        if (result.success) {
          // Update grades with result from n8n
          updateGradesFromN8N(result);
        }
      } else {
        // Fallback: simulate for demo purposes
        console.warn('n8n webhook not configured or no audio. Using simulation.');
        simulateNextStudent();
      }
    } catch (err) {
      console.error('Error processing audio:', err);
      setTranscript(prev => [...prev.filter(t => !t.isProcessing), {
        text: '❌ Error processing audio. Check console.',
        timestamp: new Date().toISOString()
      }]);
    } finally {
      setProcessingAudio(false);
      setTranscript(prev => prev.filter(t => !t.isProcessing));
    }
  };

  const updateGradesFromN8N = (result) => {
    const { studentId, studentName, scores, comments } = result;
    
    setCurrentStudent(studentName);
    setTranscript(prev => [...prev, {
      text: `${studentName}. ${Object.entries(scores).map(([key, val]) => `${key} ${val}`).join(', ')}. ${comments}`,
      timestamp: new Date().toISOString()
    }]);
    
    setGrades(prev => ({
      ...prev,
      [studentId]: {
        scores: scores,
        comments: comments,
        completed: true
      }
    }));
  };

  const simulateNextStudent = () => {
    const ungradedStudents = students.filter(s => !grades[s.id]?.completed);
    
    if (ungradedStudents.length === 0) {
      setTranscript(prev => [...prev, {
        text: '✅ All students graded!',
        timestamp: new Date().toISOString()
      }]);
      return;
    }

    const nextStudent = ungradedStudents[0];
    setCurrentStudent(nextStudent.name);
    
    const baseScores = [23, 22, 24, 21, 20, 25, 19, 23];
    const randomScores = rubricItems.reduce((acc, item, idx) => {
      acc[item.name] = baseScores[idx % baseScores.length];
      return acc;
    }, {});
    
    const comments = [
      'Excellent work showing all steps clearly. Strong understanding of concepts.',
      'Good effort. Need to work on showing more intermediate steps.',
      'Solid performance. Watch for calculation errors in the middle section.',
      'Outstanding analysis. Clear explanation of methodology.',
      'Good work overall. Could improve on organization of solution.'
    ];
    
    setTranscript(prev => [...prev, {
      text: `${nextStudent.name}. ${Object.entries(randomScores).map(([key, val]) => `${key} ${val}`).join(', ')}. ${comments[ungradedStudents.indexOf(nextStudent) % comments.length]}`,
      timestamp: new Date().toISOString()
    }]);
    
    setGrades(prev => ({
      ...prev,
      [nextStudent.id]: {
        scores: randomScores,
        comments: comments[ungradedStudents.indexOf(nextStudent) % comments.length],
        completed: true
      }
    }));
  };

  // ============================================================================
  // SAVE TO AIRTABLE
  // ============================================================================
  
  const saveToAirtable = async () => {
    setLoading(true);
    
    try {
      // Create records in Grades table for each student
      const gradeRecords = Object.entries(grades)
        .filter(([_, data]) => data.completed)
        .map(([studentId, data]) => {
          const fields = {
            [CONFIG.FIELDS.GRADES.STUDENT]: [studentId],
            [CONFIG.FIELDS.GRADES.COMMENTS]: data.comments,
            [CONFIG.FIELDS.GRADES.FINAL_GRADE]: calculateTotal(data)
          };
          
          // Add individual rubric scores as fields
          rubricItems.forEach(item => {
            fields[item.name] = data.scores[item.name] || 0;
          });
          
          return { fields };
        });
      
      // Batch create records
      const response = await airtableRequest(CONFIG.TABLES.GRADES, {
        method: 'POST',
        body: JSON.stringify({ records: gradeRecords })
      });
      
      alert(`Successfully saved ${response.records.length} grades to Airtable!`);
      
    } catch (err) {
      console.error('Error saving to Airtable:', err);
      alert('Error saving to Airtable. Check console for details.');
    } finally {
      setLoading(false);
    }
  };

  // ============================================================================
  // HELPER FUNCTIONS
  // ============================================================================
  
  const addRubricItem = () => {
    setRubricItems([...rubricItems, { name: '', maxPoints: 10 }]);
  };

  const removeRubricItem = (index) => {
    setRubricItems(rubricItems.filter((_, i) => i !== index));
  };

  const updateRubricItem = (index, field, value) => {
    const updated = [...rubricItems];
    updated[index][field] = value;
    setRubricItems(updated);
  };

  const startGrading = () => {
    if (!assignmentName.trim()) {
      alert('Please enter an assignment name');
      return;
    }
    if (rubricItems.some(item => !item.name.trim())) {
      alert('Please fill in all rubric item names');
      return;
    }
    setStep('grading');
  };

  const formatTime = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const calculateTotal = (studentGrades) => {
    if (!studentGrades.scores) return 0;
    return Object.values(studentGrades.scores).reduce((sum, score) => sum + (score || 0), 0);
  };

  const calculateMaxTotal = () => {
    return rubricItems.reduce((sum, item) => sum + (item.maxPoints || 0), 0);
  };

  const getInitials = (name) => {
    return name.split(' ').map(n => n[0]).join('');
  };

  const updateScore = (studentId, rubricItem, newScore) => {
    const maxPoints = rubricItems.find(item => item.name === rubricItem)?.maxPoints || 0;
    const validScore = Math.max(0, Math.min(newScore, maxPoints));
    
    setGrades(prev => ({
      ...prev,
      [studentId]: {
        ...prev[studentId],
        scores: {
          ...prev[studentId].scores,
          [rubricItem]: validScore
        }
      }
    }));
  };

  const updateComments = (studentId, newComments) => {
    setGrades(prev => ({
      ...prev,
      [studentId]: {
        ...prev[studentId],
        comments: newComments
      }
    }));
  };

  const toggleComplete = (studentId) => {
    setGrades(prev => ({
      ...prev,
      [studentId]: {
        ...prev[studentId],
        completed: !prev[studentId].completed
      }
    }));
  };

  // ============================================================================
  // RENDER FUNCTIONS
  // ============================================================================

  // Teacher Selection Screen
  if (step === 'teacher-select') {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="max-w-2xl w-full mx-auto px-6">
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-8">
            <h1 className="text-3xl font-bold text-gray-900 mb-2">Live Grading Assistant</h1>
            <p className="text-gray-600 mb-6">Select your teacher profile</p>
            
            {error && (
              <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg">
                <p className="text-sm text-red-800">{error}</p>
              </div>
            )}
            
            {loading ? (
              <div className="text-center py-8">
                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
                <p className="text-gray-500 mt-4">Loading teachers...</p>
              </div>
            ) : teachers.length === 0 ? (
              <div className="text-center py-8">
                <p className="text-gray-600">No teachers found. Check your Airtable configuration.</p>
              </div>
            ) : (
              <div className="space-y-3">
                {teachers.map(teacher => (
                  <button
                    key={teacher.id}
                    onClick={() => selectTeacher(teacher)}
                    className="w-full text-left p-4 border border-gray-200 rounded-lg hover:border-blue-400 hover:bg-blue-50 transition-all"
                  >
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="font-semibold text-gray-900">{teacher.name}</p>
                        <p className="text-sm text-gray-500">{teacher.email}</p>
                      </div>
                      <Play className="w-5 h-5 text-blue-600" />
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  // Class Selection Screen
  if (step === 'class-select') {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="max-w-2xl w-full mx-auto px-6">
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-8">
            <button 
              onClick={() => setStep('teacher-select')}
              className="text-blue-600 hover:text-blue-700 mb-4 text-sm"
            >
              ← Back to Teacher Selection
            </button>
            
            <h1 className="text-3xl font-bold text-gray-900 mb-2">Select Your Class</h1>
            <p className="text-gray-600 mb-6">Teacher: {selectedTeacher?.name}</p>
            
            {error && (
              <div className="mb-4 p-3 bg-yellow-50 border border-yellow-200 rounded-lg">
                <p className="text-sm text-yellow-800">{error}</p>
              </div>
            )}
            
            {loading ? (
              <div className="text-center py-8">
                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
                <p className="text-gray-500 mt-4">Loading sections...</p>
              </div>
            ) : sections.length === 0 ? (
              <div className="text-center py-8">
                <p className="text-gray-600">No sections found for this teacher.</p>
              </div>
            ) : (
              <div className="space-y-3">
                {sections.map(section => (
                  <button
                    key={section.id}
                    onClick={() => selectSection(section)}
                    className="w-full text-left p-4 border border-gray-200 rounded-lg hover:border-blue-400 hover:bg-blue-50 transition-all"
                  >
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="font-semibold text-gray-900">{section.name}</p>
                        <p className="text-sm text-gray-500">{section.studentCount} students</p>
                      </div>
                      <Play className="w-5 h-5 text-blue-600" />
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  // Setup Screen
  if (step === 'setup') {
    return (
      <div className="min-h-screen bg-gray-50 py-12">
        <div className="max-w-4xl mx-auto px-6">
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-8">
            <button 
              onClick={() => setStep('class-select')}
              className="text-blue-600 hover:text-blue-700 mb-4 text-sm"
            >
              ← Back to Class Selection
            </button>
            
            <h1 className="text-3xl font-bold text-gray-900 mb-2">Assignment Setup</h1>
            <p className="text-gray-600 mb-8">
              {selectedTeacher?.name} - {selectedSection?.name}
            </p>

            <div className="mb-8">
              <label className="block text-sm font-semibold text-gray-900 mb-2">
                Assignment Name
              </label>
              <input
                type="text"
                value={assignmentName}
                onChange={(e) => setAssignmentName(e.target.value)}
                placeholder="e.g., Unit 3 Test, Chapter 5 Quiz, Essay Assignment"
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>

            <div className="mb-8">
              <div className="flex items-center justify-between mb-4">
                <label className="block text-sm font-semibold text-gray-900">
                  Rubric Items
                </label>
                <button
                  onClick={addRubricItem}
                  className="flex items-center gap-2 px-3 py-1.5 text-sm text-blue-600 hover:bg-blue-50 rounded-lg"
                >
                  <Plus className="w-4 h-4" />
                  Add Item
                </button>
              </div>

              <div className="space-y-3">
                {rubricItems.map((item, index) => (
                  <div key={index} className="flex gap-3 items-start">
                    <input
                      type="text"
                      value={item.name}
                      onChange={(e) => updateRubricItem(index, 'name', e.target.value)}
                      placeholder="Item name (e.g., Correctness)"
                      className="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    />
                    <input
                      type="number"
                      value={item.maxPoints}
                      onChange={(e) => updateRubricItem(index, 'maxPoints', parseInt(e.target.value) || 0)}
                      placeholder="Points"
                      className="w-24 px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    />
                    <button
                      onClick={() => removeRubricItem(index)}
                      className="p-2 text-red-600 hover:bg-red-50 rounded-lg"
                      disabled={rubricItems.length === 1}
                    >
                      <Trash2 className="w-5 h-5" />
                    </button>
                  </div>
                ))}
              </div>

              <div className="mt-4 p-4 bg-blue-50 rounded-lg">
                <p className="text-sm font-semibold text-blue-900">
                  Total Points: {calculateMaxTotal()}
                </p>
              </div>
            </div>

            <div className="mb-8">
              <label className="block text-sm font-semibold text-gray-900 mb-2">
                Student Roster ({students.length} students)
              </label>
              <div className="bg-gray-50 rounded-lg p-4 max-h-48 overflow-y-auto">
                <div className="grid grid-cols-2 gap-2">
                  {students.map(student => (
                    <div key={student.id} className="text-sm text-gray-700">
                      • {student.name}
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <button
              onClick={startGrading}
              className="w-full py-4 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-lg transition-colors"
            >
              Start Grading Session
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Grading Screen
  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200 px-6 py-4">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">{assignmentName}</h1>
            <p className="text-sm text-gray-500 mt-1">
              {selectedTeacher?.name} - {selectedSection?.name}
            </p>
          </div>
          <div className="flex gap-3">
            <button 
              onClick={() => setStep('setup')}
              className="flex items-center gap-2 px-4 py-2 text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50"
            >
              Back to Setup
            </button>
            <button 
              onClick={saveToAirtable}
              className="flex items-center gap-2 px-4 py-2 text-white bg-green-600 hover:bg-green-700 rounded-lg"
            >
              <Download className="w-4 h-4" />
              Save to Airtable
            </button>
          </div>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-6 py-6">
        <div className="grid grid-cols-3 gap-6">
          
          <div className="col-span-1 space-y-6">
            <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
              <h2 className="text-lg font-semibold text-gray-900 mb-4">Recording</h2>
              
              <div className="flex flex-col items-center gap-4">
                <button 
                  onClick={isRecording ? stopRecording : startRecording}
                  className={`w-20 h-20 rounded-full flex items-center justify-center transition-all ${
                    isRecording 
                      ? 'bg-red-500 hover:bg-red-600 animate-pulse' 
                      : 'bg-blue-500 hover:bg-blue-600'
                  }`}
                >
                  {isRecording ? (
                    <Square className="w-8 h-8 text-white" />
                  ) : (
                    <Mic className="w-8 h-8 text-white" />
                  )}
                </button>
                
                <div className="text-center">
                  <p className="text-sm font-medium text-gray-900">
                    {isRecording ? 'Recording...' : 'Ready to Record'}
                  </p>
                  <p className="text-2xl font-mono text-gray-600 mt-2">
                    {formatTime(recordingTime)}
                  </p>
                  {currentStudent && (
                    <p className="text-sm text-blue-600 font-medium mt-2">
                      Currently: {currentStudent}
                    </p>
                  )}
                  {processingAudio && (
                    <p className="text-sm text-orange-600 font-medium mt-2 animate-pulse">
                      ⏳ Processing...
                    </p>
                  )}
                </div>
                
                {isRecording && (
                  <div className="mt-4 p-3 bg-blue-50 rounded-lg border border-blue-200">
                    <p className="text-xs font-semibold text-blue-900 mb-1">How to use:</p>
                    <p className="text-xs text-blue-800">
                      🎤 Speak your assessment for one student<br/>
                      ⌨️ Press <kbd className="px-2 py-0.5 bg-white border border-blue-300 rounded text-blue-900 font-mono">SPACE</kbd> when done<br/>
                      ⏳ Wait 2-3 seconds for AI to process<br/>
                      🔄 Move to next student
                    </p>
                  </div>
                )}
              </div>
            </div>

            <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
              <h2 className="text-lg font-semibold text-gray-900 mb-4">Rubric Reference</h2>
              <div className="space-y-2">
                {rubricItems.map((item, index) => (
                  <div key={index} className="flex justify-between items-center">
                    <span className="text-sm text-gray-700">{item.name}</span>
                    <span className="text-sm font-semibold text-gray-900">/{item.maxPoints}</span>
                  </div>
                ))}
                <div className="pt-2 border-t border-gray-200 flex justify-between items-center">
                  <span className="text-sm font-semibold text-gray-900">Total</span>
                  <span className="text-sm font-bold text-blue-600">/{calculateMaxTotal()}</span>
                </div>
              </div>
            </div>

            <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
              <h2 className="text-lg font-semibold text-gray-900 mb-4">Your Dictation</h2>
              <div className="h-96 overflow-y-auto bg-gray-50 rounded p-4 text-sm text-gray-700 leading-relaxed">
                {transcript.length === 0 ? (
                  <p className="text-gray-400 italic">
                    {isRecording ? 'Speak your assessment, then press SPACEBAR to process...' : 'Start recording to dictate grades'}
                  </p>
                ) : (
                  transcript.map((entry, idx) => (
                    <p key={idx} className={`mb-3 ${entry.isProcessing ? 'text-orange-600 animate-pulse' : ''}`}>
                      {entry.text}
                    </p>
                  ))
                )}
              </div>
            </div>
          </div>

          <div className="col-span-2">
            <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-semibold text-gray-900">
                  Student Progress ({Object.values(grades).filter(g => g.completed).length}/{students.length})
                </h2>
              </div>

              <div className="space-y-3">
                {students
                  .sort((a, b) => {
                    if (currentStudent === a.name) return -1;
                    if (currentStudent === b.name) return 1;
                    const aCompleted = grades[a.id]?.completed || false;
                    const bCompleted = grades[b.id]?.completed || false;
                    if (aCompleted && !bCompleted) return 1;
                    if (!aCompleted && bCompleted) return -1;
                    return 0;
                  })
                  .map(student => {
                  const studentGrades = grades[student.id] || { scores: {}, comments: '', completed: false };
                  const total = calculateTotal(studentGrades);
                  const colorOptions = ['bg-blue-100 text-blue-600', 'bg-green-100 text-green-600', 'bg-purple-100 text-purple-600', 'bg-orange-100 text-orange-600'];
                  const colorClass = colorOptions[students.indexOf(student) % 4];

                  return (
                    <div 
                      key={student.id} 
                      className={`border rounded-lg p-4 transition-all ${
                        currentStudent === student.name 
                          ? 'border-blue-500 bg-blue-50 shadow-md' 
                          : studentGrades.completed 
                            ? 'border-green-300 bg-green-50'
                            : 'border-gray-200 hover:border-blue-300'
                      }`}
                    >
                      <div className="flex items-start justify-between mb-3">
                        <div className="flex items-center gap-3">
                          <div className={`w-10 h-10 rounded-full flex items-center justify-center font-semibold ${colorClass}`}>
                            {getInitials(student.name)}
                          </div>
                          <div>
                            <p className="font-semibold text-gray-900">{student.name}</p>
                            <p className="text-xs text-gray-500">ID: {student.studentId}</p>
                          </div>
                        </div>
                        <div className="text-right">
                          <p className={`text-2xl font-bold ${studentGrades.completed ? 'text-gray-900' : 'text-gray-400'}`}>
                            {studentGrades.completed ? total : '--'}
                          </p>
                          <p className="text-xs text-gray-500">
                            {studentGrades.completed ? `/${calculateMaxTotal()}` : 'Not Graded'}
                          </p>
                        </div>
                      </div>
                      
                      <div className="grid grid-cols-4 gap-2 mb-3">
                        {rubricItems.map(item => {
                          const isEditing = editingStudent === student.id && editingField === item.name;
                          const score = studentGrades.scores[item.name] || 0;
                          
                          return (
                            <div key={item.name} className="text-center p-2 bg-white rounded border border-gray-200">
                              <p className="text-xs text-gray-600 truncate mb-1">{item.name}</p>
                              {isEditing ? (
                                <input
                                  type="number"
                                  value={score}
                                  onChange={(e) => updateScore(student.id, item.name, parseInt(e.target.value) || 0)}
                                  onBlur={() => {
                                    setEditingStudent(null);
                                    setEditingField(null);
                                  }}
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter') {
                                      setEditingStudent(null);
                                      setEditingField(null);
                                    }
                                  }}
                                  min="0"
                                  max={item.maxPoints}
                                  autoFocus
                                  className="w-full text-lg font-semibold text-center border border-blue-500 rounded px-1 focus:outline-none focus:ring-2 focus:ring-blue-500"
                                />
                              ) : (
                                <p 
                                  onClick={() => {
                                    setEditingStudent(student.id);
                                    setEditingField(item.name);
                                  }}
                                  className={`text-lg font-semibold cursor-pointer hover:bg-blue-50 rounded px-1 ${
                                    studentGrades.completed ? 'text-gray-900' : 'text-gray-400'
                                  }`}
                                  title="Click to edit"
                                >
                                  {score || '--'}
                                </p>
                              )}
                              <p className="text-xs text-gray-500">/ {item.maxPoints}</p>
                            </div>
                          );
                        })}
                      </div>

                      <div className={`${studentGrades.completed ? 'bg-blue-50' : 'bg-gray-50'} rounded p-3`}>
                        <div className="flex items-center justify-between mb-1">
                          <p className={`text-xs font-semibold ${studentGrades.completed ? 'text-blue-900' : 'text-gray-500'}`}>
                            Comments:
                          </p>
                          <button
                            onClick={() => {
                              if (editingStudent === student.id && editingField === 'comments') {
                                setEditingStudent(null);
                                setEditingField(null);
                              } else {
                                setEditingStudent(student.id);
                                setEditingField('comments');
                              }
                            }}
                            className="text-xs text-blue-600 hover:text-blue-700 font-medium"
                          >
                            {editingStudent === student.id && editingField === 'comments' ? 'Done' : 'Edit'}
                          </button>
                        </div>
                        {editingStudent === student.id && editingField === 'comments' ? (
                          <textarea
                            value={studentGrades.comments}
                            onChange={(e) => updateComments(student.id, e.target.value)}
                            onBlur={() => {
                              setTimeout(() => {
                                setEditingStudent(null);
                                setEditingField(null);
                              }, 200);
                            }}
                            rows={3}
                            autoFocus
                            className="w-full text-sm p-2 border border-blue-500 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                          />
                        ) : (
                          <p 
                            onClick={() => {
                              setEditingStudent(student.id);
                              setEditingField('comments');
                            }}
                            className="text-sm text-gray-700 cursor-pointer hover:bg-blue-100 rounded p-1"
                            title="Click to edit"
                          >
                            {studentGrades.comments || 'Click to add comments...'}
                          </p>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}
