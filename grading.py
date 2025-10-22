import os
import logging
import openai
import gspread
from oauth2client.service_account import ServiceAccountCredentials

########################################
# 1) SETUP OPENAI
########################################
api_key_path = "openai_key.txt"

try:
    with open(api_key_path, "r") as key_file:
        openai.api_key = key_file.read().strip()
    # In your working code you used:
    # openai_client = OpenAI(api_key=openai.api_key)
    # For this script we'll simply alias the openai module as our client.
    openai_client = openai
except FileNotFoundError:
    logging.error(f"API key file not found at {api_key_path}")
    raise
except Exception as e:
    logging.error(f"Error loading OpenAI API key: {e}")
    raise

# Path to your Google Service Account credentials file.
creds_json_path = "/Users/kevinringuette/Library/Mobile Documents/com~apple~CloudDocs/Pacifica/Scripts/Linen Patrol Grading.json"

def authorize_google_sheets(creds_json_path, spreadsheet_name):
    """
    Authorizes access to Google Sheets and returns the spreadsheet object.
    """
    scope = [
        "https://spreadsheets.google.com/feeds",
        "https://www.googleapis.com/auth/drive"
    ]
    creds = ServiceAccountCredentials.from_json_keyfile_name(creds_json_path, scope)
    client = gspread.authorize(creds)
    return client.open(spreadsheet_name)

def get_rubric_text(rubric_sheet, cell_range="A1:C8"):
    """
    Retrieves the rubric from the specified range and converts it into a text block.
    """
    rubric_cells = rubric_sheet.get(cell_range)
    rubric_lines = []
    for row in rubric_cells:
        # Join each cell content using " | " as a delimiter.
        line = " | ".join(str(cell) for cell in row)
        rubric_lines.append(line)
    rubric_text = "\n".join(rubric_lines)
    return rubric_text

def get_custom_prompt_text(spreadsheet, prompt_sheet_name="Prompt"):
    """
    Retrieves the custom grading prompt from the worksheet titled "Prompt".
    Assumes that the worksheet has a header "prompt" in the first row and that
    the actual custom prompt is in the first data row under that header.
    """
    worksheet_prompt = spreadsheet.worksheet(prompt_sheet_name)
    data = worksheet_prompt.get_all_values()
    if not data:
        raise Exception("The Prompt worksheet is empty.")
    headers = data[0]
    try:
        prompt_idx = headers.index("prompt")
    except ValueError:
        raise Exception("The header 'prompt' was not found in the Prompt worksheet.")
    if len(data) < 2 or not data[1][prompt_idx]:
        raise Exception("No prompt text found under the 'prompt' header in the Prompt worksheet.")
    custom_prompt = data[1][prompt_idx]
    return custom_prompt

def grade_response_with_openai(rubric_text, student_answer, custom_prompt):
    """
    Constructs a prompt to evaluate a student answer against a dynamically provided rubric,
    along with a custom grading prompt loaded from the "Prompt" worksheet, using the OpenAI API.
    The final prompt instructs the assistant to analyze the rubric, apply it to the student answer,
    and return a grading summary in valid JSON.
    """
    prompt = (
        # Prepend the custom instructions from the Prompt worksheet.
        f"{custom_prompt}\n\n"
        "Rubric:\n"
        f"{rubric_text}\n\n"
        "Student Answer:\n"
        f"{student_answer}\n\n"
        "Instructions:\n"
        "1. Analyze the provided rubric to determine all grading criteria and any associated point values. \n"
        "2. Evaluate the student answer according to each criterion and assign an appropriate score. \n"
        "3. Calculate an overall grade from the individual scores (explain your method clearly). \n"
        "4. Provide a brief explanation of how each score and the overall grade were determined. \n"
        "5. Return your answer strictly in valid JSON format with exactly the following keys:\n"
        "   {\n"
        "     \"Criteria\": { \"<criterion1>\": <score>, \"<criterion2>\": <score>, ... },\n"
        "     \"Overall\": <overall grade>,\n"
        "     \"Explanation\": \"<brief explanation>\"\n"
        "   }\n"
        "Do not include any additional text outside the JSON."
    )
    
    response = openai_client.chat.completions.create(
        model="gpt-4-0613",
        messages=[
            {"role": "system", "content": "You are a helpful grading assistant."},
            {"role": "user", "content": prompt}
        ],
        temperature=0.0  # Lower temperature for more deterministic responses.
    )
    
    answer = response.choices[0].message.content.strip()
    return answer

def process_student_answers(spreadsheet, answers_sheet_name="sampel answers", rubric_sheet_name="sample rubric", prompt_sheet_name="Prompt"):
    """
    Reads student answers from the answers sheet, grades them using the rubric from the rubric sheet
    and the custom prompt from the Prompt worksheet, and writes the grading results back to the answers sheet.
    """
    # Access the worksheets by name.
    worksheet_answers = spreadsheet.worksheet(answers_sheet_name)
    worksheet_rubric = spreadsheet.worksheet(rubric_sheet_name)
    
    # Get the custom grading prompt from the "Prompt" worksheet.
    custom_prompt = get_custom_prompt_text(spreadsheet, prompt_sheet_name)
    print("Custom Grading Prompt loaded:\n", custom_prompt)
    
    # Retrieve and format the rubric.
    rubric_text = get_rubric_text(worksheet_rubric, cell_range="A1:E8")
    print("Rubric loaded:\n", rubric_text)
    
    # Retrieve all data from the answers sheet (assumes row 1 contains headers).
    answers_data = worksheet_answers.get_all_values()
    headers = answers_data[0]
    
    # Determine the column containing student responses. We assume the header is exactly "Answer".
    try:
        answer_col_index = headers.index("Answer")
    except ValueError:
        raise Exception("The header 'Answer' was not found in the answers sheet.")
    
    # Check for the "Grade" column. If missing, create it as the next column.
    if "Grade" not in headers:
        worksheet_answers.update_cell(1, len(headers) + 1, "Grade")
        grade_col_index = len(headers)  # update_cell uses 1-indexed column numbers.
    else:
        grade_col_index = headers.index("Grade")
    
    # Process each student's answer (skip the header row).
    for row_idx, row in enumerate(answers_data[1:], start=2):
        student_answer = row[answer_col_index]
        if not student_answer.strip():
            continue  # Skip empty responses.
        
        print(f"Grading answer on row {row_idx}...")
        graded_result = grade_response_with_openai(rubric_text, student_answer, custom_prompt)
        print(f"Graded result for row {row_idx}: {graded_result}")
        
        # Write the graded result back to the "Grade" column.
        worksheet_answers.update_cell(row_idx, grade_col_index + 1, graded_result)

def main():
    # Spreadsheet name as provided.
    spreadsheet_name = "Sample Responses"
    
    # Authorize and open the spreadsheet.
    spreadsheet = authorize_google_sheets(creds_json_path, spreadsheet_name)
    
    # Process and grade student answers using the rubric and custom prompt.
    process_student_answers(
        spreadsheet,
        answers_sheet_name="sampel answers",
        rubric_sheet_name="sample rubric",
        prompt_sheet_name="Prompt"
    )

if __name__ == "__main__":
    main()
